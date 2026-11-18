// maru-cal: EventKit 로 캘린더를 읽기 전용으로 읽어 표준출력에 레코드를 쓴다(Foundation + EventKit 만, 네트워크·파일 쓰기 없음).
// 사용법:
//   maru-cal today                 오늘 0시부터 이틀 안에 겹치는 일정(시작이 앞서면 창 시작으로 당김)
//   maru-cal month <YYYY> <M>      그 달에 겹치는 일정(시작이 앞서면 달 시작으로 당김)
//   maru-cal day <YYYY> <M> <D>    그 날에 겹치는 일정(실제 시작·끝, 장소·메모 포함)
//   maru-cal status                authorized | denied | restricted | notDetermined (권한을 묻지 않는다)
//   maru-cal selftest [today|month|day]   가상 일정으로 같은 서식 코드만 실행(EventKit 접근 없음)
// 출력: 필드는 US(0x1F), 레코드는 RS(0x1E)로 끝낸다.
//   today/month: 날짜 yyyy-MM-dd, 시각 HH:mm 또는 빈 값, 종일 1|0, 제목
//   day: 시작 날짜, 시작 시각, 종일, 제목, 끝 날짜, 끝 시각, 캘린더 이름, 장소, 메모
// 종료 코드: 0 정상, 1 기타 오류, 2 사용법, 3 권한 없음(거부·제한·쓰기 전용·요청 뒤에도 허용 안 됨), 4 권한 요청 시간 초과(60초 동안 답이 없음)만.
// 크기 상한(앱 파서보다 같거나 크게; 앱은 제목 60자·종류별 일정 수는 오늘 8 / 하루 상세 30 / 달 하루 12·한 달 400, 장소 200·캘린더 이름 80·메모 600자를 남긴다):
//   제목 80, 장소 200, 캘린더 이름 80, 메모 800자. 하루 보기 최대 60개, 오늘 최대 20개, 달 보기는 하루 12개·최대 31*12개(날짜별 종일 먼저·시각순으로 앞에서부터).
import Foundation
import EventKit

setvbuf(stdout, nil, _IOFBF, 1 << 16)

func usage() -> Never {
    FileHandle.standardError.write("usage: maru-cal today | month <YYYY> <M> | day <YYYY> <M> <D> | status | selftest [today|month|day]\n".data(using: .utf8)!)
    exit(2)
}
func die(_ code: Int32) -> Never { fflush(stdout); exit(code) }

// ---- 서식(순수 함수) ----
struct Ev {
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool
    var calName: String
    var location: String
    var notes: String
}

let greg: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone.current
    c.locale = Locale(identifier: "en_US_POSIX")
    return c
}()
func makeFormatter(_ f: String) -> DateFormatter {
    let d = DateFormatter()
    d.locale = Locale(identifier: "en_US_POSIX")
    d.calendar = greg
    d.timeZone = TimeZone.current
    d.dateFormat = f
    return d
}
let dateFmt = makeFormatter("yyyy-MM-dd")
let timeFmt = makeFormatter("HH:mm")

// 글 필드: 길이를 먼저 자르고(문자 단위), RS/US 와 제어 문자를 제거한다(탭·줄바꿈만 남긴다).
func clean(_ s: String, max: Int) -> String {
    let cut = String(s.prefix(max))
    var out = String.UnicodeScalarView()
    for u in cut.unicodeScalars {
        let v = u.value
        if v == 0x09 || v == 0x0A || v == 0x0D { out.append(u); continue }
        if v < 0x20 || (v >= 0x7F && v <= 0x9F) { continue }
        out.append(u)
    }
    return String(out)
}

let RS = "\u{1E}", US = "\u{1F}"
enum Mode { case today, month, day }

// 앱 파서와 같은 순서: 날짜, 종일 먼저, 시각, 제목
func before(_ a: Ev, _ b: Ev) -> Bool {
    let da = dateFmt.string(from: a.start), db = dateFmt.string(from: b.start)
    if da != db { return da < db }
    if a.allDay != b.allDay { return a.allDay }
    let ta = timeFmt.string(from: a.start), tb = timeFmt.string(from: b.start)
    if ta != tb { return ta < tb }
    return a.title < b.title
}
let TITLE_MAX = 80, LOC_MAX = 200, CAL_MAX = 80, NOTES_MAX = 800
let DAY_MODE_MAX = 60, TODAY_MAX = 20, MONTH_PER_DAY = 12, MONTH_MAX = 31 * 12

func format(_ mode: Mode, events: [Ev], winStart: Date, winEnd: Date) -> String {
    var list = events.filter { $0.start < winEnd && $0.end > winStart }
    if mode != .day { for i in list.indices where list[i].start < winStart { list[i].start = winStart } }
    list.sort(by: before)
    var picked: [Ev] = []
    switch mode {
    case .today: picked = Array(list.prefix(TODAY_MAX))
    case .day: picked = Array(list.prefix(DAY_MODE_MAX))
    case .month:
        var perDay: [String: Int] = [:]
        for e in list {
            if picked.count >= MONTH_MAX { break }
            let d = dateFmt.string(from: e.start)
            let n = perDay[d] ?? 0
            if n >= MONTH_PER_DAY { continue }
            perDay[d] = n + 1
            picked.append(e)
        }
    }
    var out = ""
    for e in picked {
        let title = clean(e.title, max: TITLE_MAX)
        let tm = e.allDay ? "" : timeFmt.string(from: e.start)
        let fl = e.allDay ? "1" : "0"
        var f = [dateFmt.string(from: e.start), tm, fl, title]
        if mode == .day {
            let ed = e.allDay ? e.end.addingTimeInterval(-1) : e.end // 종일의 끝은 하루 안으로(배타 끝 대비)
            f += [dateFmt.string(from: ed), e.allDay ? "" : timeFmt.string(from: ed), clean(e.calName, max: CAL_MAX), clean(e.location, max: LOC_MAX), clean(e.notes, max: NOTES_MAX)]
        }
        out += f.joined(separator: US) + RS
    }
    return out
}

// ---- 창 계산(현지 시간대, 그레고리력) ----
func dayStart(_ y: Int, _ m: Int, _ d: Int) -> Date? {
    var c = DateComponents(); c.year = y; c.month = m; c.day = d; c.hour = 0; c.minute = 0; c.second = 0
    guard let t = greg.date(from: c) else { return nil }
    let r = greg.dateComponents([.year, .month, .day], from: t)
    if r.year == y && r.month == m && r.day == d { return t }
    // 자정이 없는 날(서머타임)은 첫 순간을 쓴다
    let noon = greg.date(bySettingHour: 12, minute: 0, second: 0, of: t) ?? t
    let s = greg.startOfDay(for: noon)
    let r2 = greg.dateComponents([.year, .month, .day], from: s)
    return r2.year == y && r2.month == m && r2.day == d ? s : nil
}
func parseInt(_ s: String, _ lo: Int, _ hi: Int) -> Int? {
    guard s.count <= 4, !s.isEmpty, s.allSatisfy({ $0 >= "0" && $0 <= "9" }), let n = Int(s), n >= lo, n <= hi else { return nil }
    return n
}
func window(_ mode: Mode, _ a: [Int]) -> (Date, Date)? {
    switch mode {
    case .today:
        let s = greg.startOfDay(for: Date())
        guard let e = greg.date(byAdding: .day, value: 2, to: s) else { return nil }
        return (s, e)
    case .month:
        guard let s = dayStart(a[0], a[1], 1) else { return nil }
        guard let e = greg.date(byAdding: .month, value: 1, to: s) else { return nil }
        return (s, e)
    case .day:
        guard let s = dayStart(a[0], a[1], a[2]) else { return nil }
        guard let e = greg.date(byAdding: .day, value: 1, to: s) else { return nil }
        return (s, e)
    }
}

// ---- 인자 ----
let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { usage() }

func parseArgs() -> (Mode, [Int]) {
    switch cmd {
    case "today": if args.count != 1 { usage() }; return (.today, [])
    case "month":
        guard args.count == 3, let y = parseInt(args[1], 2000, 2100), let m = parseInt(args[2], 1, 12) else { usage() }
        return (.month, [y, m])
    case "day":
        guard args.count == 4, let y = parseInt(args[1], 2000, 2100), let m = parseInt(args[2], 1, 12), let d = parseInt(args[3], 1, 31) else { usage() }
        return (.day, [y, m, d])
    default: usage()
    }
}

// ---- 상태 ----
func statusWord() -> String {
    switch EKEventStore.authorizationStatus(for: .event).rawValue {
    case 0: return "notDetermined"
    case 1: return "restricted"
    case 3: return "authorized" // 구형 authorized 와 14+ fullAccess 가 같은 값
    default: return "denied" // denied, writeOnly(읽기 불가)
    }
}

if cmd == "status" {
    if args.count != 1 { usage() }
    print(statusWord()); die(0)
}

if cmd == "selftest" {
    if args.count > 3 || (args.count == 3 && args[2] != "many") { usage() }
    var mode = Mode.today
    if args.count >= 2 { switch args[1] { case "today": mode = .today; case "month": mode = .month; case "day": mode = .day; default: usage() } }
    let now = Date()
    let s0 = greg.startOfDay(for: now)
    func at(_ day: Int, _ h: Int, _ mi: Int = 0) -> Date { greg.date(byAdding: .minute, value: h * 60 + mi, to: greg.date(byAdding: .day, value: day, to: s0)!)! }
    let fake: [Ev] = [
        Ev(title: "Sample standup", start: at(0, 9, 30), end: at(0, 10), allDay: false, calName: "Sample", location: "Room A", notes: "Line one\nLine two"),
        Ev(title: "Sample holiday", start: at(0, 0), end: at(1, 0), allDay: true, calName: "Holidays", location: "", notes: ""),
        Ev(title: "Sample overnight", start: at(-1, 22), end: at(0, 1), allDay: false, calName: "Sample", location: "", notes: ""),
        Ev(title: "Hostile\u{1E}ti\u{1F}tle\u{07}x", start: at(0, 14), end: at(0, 15, 30), allDay: false, calName: "Cal\u{1F}name", location: "Loc\u{1E}ation", notes: "Note\u{1F}s\u{1E}"),
        Ev(title: String(repeating: "L", count: 300), start: at(0, 16), end: at(0, 17), allDay: false, calName: String(repeating: "c", count: 200), location: String(repeating: "p", count: 500), notes: String(repeating: "n", count: 2500)),
        Ev(title: "Sample tomorrow", start: at(1, 11), end: at(1, 12), allDay: false, calName: "Sample", location: "", notes: ""),
    ]
    var fakeAll = fake
    if CommandLine.arguments.last == "many" { // 상한 시험: 오늘 하루에 겹치는 일정 많이
        for i in 0..<80 { fakeAll.append(Ev(title: "Bulk \(i)", start: at(0, 8, i % 50), end: at(0, 9), allDay: false, calName: "B", location: "", notes: "")) }
    }
    let c = greg.dateComponents([.year, .month, .day], from: now)
    guard let w = window(mode, [c.year!, c.month!, c.day!]) else { die(1) }
    print(format(mode, events: fakeAll, winStart: w.0, winEnd: w.1), terminator: "")
    die(0)
}

// ---- EventKit 읽기 ----
let (mode, nums) = parseArgs()
guard let win = window(mode, nums) else { usage() }

// 권한 답을 받은 콜백이 불렸는지(스레드 안전)
final class Answer: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false
    func fire() { lock.lock(); fired = true; lock.unlock() }
    var isFired: Bool { lock.lock(); defer { lock.unlock() }; return fired }
}
// 권한 창의 답을 기다린다. 실행 루프를 돌리며 기다려 콜백이 어느 스레드에서 오든 막히지 않는다. 60초 안에 콜백이 불렸으면 true, 시간 초과면 false.
func askAccess(_ store: EKEventStore) -> Bool {
    let ans = Answer()
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, _ in ans.fire() }
    } else {
        store.requestAccess(to: .event) { _, _ in ans.fire() }
    }
    let limit = Date().addingTimeInterval(60)
    while !ans.isFired && Date() < limit {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
    }
    return ans.isFired
}

func readEvents() -> [Ev] {
    var store = EKEventStore()
    if statusWord() == "notDetermined" {
        if !askAccess(store) { die(4) } // 시간 초과만 4
        if statusWord() != "authorized" { die(3) } // 콜백 뒤에는 오류든 거부든 상태로 판단한다
        store = EKEventStore() // 방금 허용된 저장소는 빈 결과를 줄 수 있어 새로 만든다
    }
    if statusWord() != "authorized" { die(3) }
    let pred = store.predicateForEvents(withStart: win.0, end: win.1, calendars: nil) // 반복 일정의 각 회차 포함
    return store.events(matching: pred).map {
        Ev(title: $0.title ?? "", start: $0.startDate, end: $0.endDate ?? $0.startDate, allDay: $0.isAllDay,
           calName: $0.calendar?.title ?? "", location: mode == .day ? ($0.location ?? "") : "", notes: mode == .day ? ($0.notes ?? "") : "")
    }
}
print(format(mode, events: readEvents(), winStart: win.0, winEnd: win.1), terminator: "")
die(0)
