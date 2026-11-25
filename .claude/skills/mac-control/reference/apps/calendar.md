# Calendar (com.apple.iCal)

## 일정 만들기 (검증됨)
- 날짜는 문자열 파싱 대신 `current date` 를 복사해 year/month/day/hours/minutes/seconds 를 하나씩 설정한다(로캘 형식에 안 흔들림).
- `tell calendar "<이름>" to make new event with properties {summary:…, start date:s, end date:e, location:…, description:…}`
- 알림: `make new display alarm at end of display alarms of ev with properties {trigger interval:-60}` (분 단위, 음수 = 시작 전). 하루 전은 -1440.
- 검증: `every event of calendar "<이름>" whose start date is s` 로 다시 읽고 `count of display alarms` 확인. 시작 시각을 정확히 지정하면 전체 이벤트를 훑지 않아 빠르다.

## 함정
- `get name of every calendar` 에 "예정된 미리 알림"·"Siri 제안" 같은 읽기 전용 캘린더도 섞여 나온다. 쓰기 대상은 이름으로 정확히 고른다.
- AppleScript `every event … whose` 는 반복 일정을 펼치지 않는다(첫 발생일만 나옴). 특정 연도의 생일·반복 일정은 EventKit(`swift` 스크립트, `predicateForEvents` + `calendars(for: .event)`)으로 읽어야 실제 날짜가 나온다. 생일 캘린더는 이름 대신 `$0.type == .birthday` 로 고른다(이름이 로캘마다 다름). 음력 생일도 그해 양력 날짜로 펼쳐진다.
