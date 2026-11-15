# 마루 (maru)

Claude Code 위에서 도는 **개인 총괄 에이전트**입니다. 이 폴더에서 `claude`를 실행하면 마루가 되고, 쓸수록 사용자에 맞춰지도록 대화를 회고해 장기 기억을 쌓습니다.

- **회고(학습 루프)**: 세션이 끝날 때(SessionEnd 훅) 제한된 권한의 헤드리스 `claude -p`가 대화 요약을 읽고 기억 파일을 갱신합니다.
- **정기 정리(dream)**: 매일 03:30 launchd 작업이 놓친 세션을 회고하고 기억을 정리합니다.
- **스킬 제안**: 반복되는 절차는 `data/skill-proposals/`에 제안으로만 쌓입니다. 기본값에서는 에이전트가 제안 내용을 한 줄로 알리고 사용자가 명시적으로 승인한 뒤에만 설치합니다(아래 `MARU_SKILL_AUTOINSTALL` 참고).
- **recall 스킬**: 과거 대화를 검색합니다.
- **mac-control 스킬**: 맥 자체를 다루는 일(앱·파일·설정·시스템 상태·캘린더 등)을 가장 가벼운 수단부터 골라 수행합니다(아래 「맥 통제」).

## 요구사항
macOS(launchd, BSD `stat`/`md5` 사용), `claude`(Claude Code, 구독 로그인), `jq`, `python3`, `git`, `perl`.

`python3`/`git` 은 존재만이 아니라 실제로 실행해 확인합니다. Xcode 라이선스 미동의 등으로 `/usr/bin` 의 것이 실패하면 `/Library/Developer/CommandLineTools/usr/bin`, `/opt/homebrew/bin`, `/usr/local/bin` 에서 동작하는 것을 찾아 PATH 앞에 둡니다(`maru doctor` 가 "폴백 사용 중(원인)" 으로 알려 줌). 어느 것도 없으면 즉시 실패하고, 라이선스 문제로 보이면 `sudo xcodebuild -license` 를 안내합니다. 도구·기억 폴더 문제로 회고/정리가 실패하면 처음 한 번 macOS 알림을 보내고, 그 세션은 처리 완료로 표시하지 않아 다음 실행에서 재시도합니다. 놓친 세션을 한 번 보충하려면 `MARU_SWEEP_HOURS=96 scripts/dream.sh`(sweep 시간 창, 기본 36시간, 1~720 정수).

## 설치 / 제거
```
./install.sh --dry-run   # 할 일만 출력
./install.sh             # 멱등: 여러 번 실행해도 안전
./uninstall.sh           # 설치한 것만 되돌림 (data/ 와 기억은 남김). --dry-run 지원
./install.sh --with-cli --with-cmux   # 선택: maru 명령 링크 + cmux Dock 설정 (아래 설명)
```
설치가 하는 일(경로에 공백이 있어도 동작): `data/`와 기억 폴더 생성 / `~/.claude/settings.json`의 SessionEnd에 훅 1개 등록(수정 전 `data/backups/`에 타임스탬프 백업. 파일 전체를 JSON으로 읽어 다시 쓰므로 **파일이 재작성된다**: 키 순서·알 수 없는 필드·다른 훅의 위치는 보존하고 들여쓰기 형식을 유지하며 임시 파일 + rename으로 원자적으로 쓰지만, 주석처럼 JSON 밖의 서식은 보존되지 않는다) / launchd 작업 `com.maru.dream` 등록 / `recall` 스킬을 `~/.claude/skills/recall`에 복사(`.maru` 표식 파일을 넣고, 표식 없는 기존 `recall`은 건드리지 않음) / `.claude/settings.local.json`에 홈 디렉터리 접근 허용 / `~/.claude/CLAUDE.md`에 `<!-- maru:begin -->`…`<!-- maru:end -->` 블록 유지.

제거(`uninstall.sh`)는 설치가 한 일만 되돌립니다: 훅 항목, launchd 작업, `~/.claude/CLAUDE.md`의 maru 블록(블록 밖은 건드리지 않음), `.maru` 표식이 있는 전역 recall, `.claude/settings.local.json`의 홈 접근 항목, `~/.maru-work`. **`data/`(개인 데이터·변경 이력·백업)와 기억 폴더는 남깁니다.**

선택 옵션(기본 꺼짐, `--dry-run` 지원, 옵션 없이 실행하면 위 동작과 동일):
- `--with-cli`: `bin/maru` 를 `$MARU_BIN_DIR`(없으면 `~/.local/bin`, 없으면 생성)에 심볼릭 링크합니다. sudo·시스템 폴더(`/usr/local/bin` 등)는 쓰지 않고, 거기 이미 `maru` 가 있으면(다른 파일·다른 링크) 덮어쓰지 않고 경고 후 건너뜁니다(이 저장소를 가리키면 "이미 설치됨"). 폴더가 PATH 에 없으면 셸 설정 파일은 고치지 않고 추가할 한 줄만 안내합니다.
- `--with-cmux`: cmux 가 있으면(`/Applications/cmux.app` 또는 `cmux` 명령) `${XDG_CONFIG_HOME:-~/.config}/cmux/dock.json` 을 설치합니다(`command` 에 설치 시점의 실제 저장소 경로를 채움). 파일이 없을 때 만들고, maru 가 만든 것(컨트롤이 id `maru-ui` 하나뿐이고 생성 내용과 같거나 `"$HOME/maru/bin/maru" ui` 형식이며 그 경로가 이 저장소)이면 갱신합니다. 그 외(다른 컨트롤이 있거나 내용이 다름)는 수정하지 않고 추가할 JSON 조각만 출력합니다(자동 병합 없음). `dock.json` 이 심볼릭 링크(끊어진 링크 포함)이면 dotfiles 관리 대상으로 보고 절대 건드리지 않습니다(설정 폴더 자체가 링크인 것은 허용). 갱신·삭제 전 백업이 실패하면 아무것도 바꾸지 않고 중단합니다. `$MARU_BIN_DIR` 는 `..` 를 거부하고 실경로로 정규화해 시스템 폴더(`/Applications` 포함)를 막습니다. 시험은 `scripts/test-optional.sh`(임시 폴더만 사용).
- `uninstall.sh --with-cli --with-cmux`: 링크는 이 저장소 `bin/maru` 를 가리킬 때만, `dock.json` 은 maru 가 만든 것과 같을 때만 지웁니다(`data/backups/` 에 백업 후). 그 외는 건드리지 않고 안내합니다.

### 홈 디렉터리 전체 접근은 의도된 선택
`.claude/settings.local.json`의 `permissions.additionalDirectories`에 홈을 넣는 것은 총괄 에이전트가 이 맥 전체에서 일하도록 한 의도적 선택입니다. 즉 `~/maru`에서 실행한 `claude`는 홈 아래 어디든 읽고(쓰기·실행은 일반 권한 규칙에 따름) 작업할 수 있으니, 신뢰할 수 있는 지시만 주세요. 좁히려면 그 파일의 `additionalDirectories`를 필요한 폴더 목록으로 바꾸거나 항목을 지우면 됩니다(`install.sh` 재실행은 홈을 다시 추가하므로 설치 후 직접 편집하세요). 이 설정은 헤드리스 회고에는 적용되지 않습니다(작업 폴더가 저장소 밖이므로).

### 읽기 전용 명령 자동 허용
`.claude/settings.json`의 `permissions.allow`에는 맥 상태를 조회만 하는 명령(`mdls`, `pmset -g`, `brew list`, `bin/maru status` 등)이 들어 있어 매번 확인하지 않습니다. 변경·발신·삭제·네트워크 전송·스크립트 실행 같은 명령은 허용하지 않으므로 계속 확인을 받습니다. 끄려면 그 파일에서 해당 항목(또는 `allow` 전체)을 지우면 됩니다. 내 설정은 `.claude/settings.local.json`에 따로 둘 수 있습니다.

### 설정
`scripts/lib.sh` 상단 블록의 값은 환경변수나 `data/maru.conf`(`VAR=${VAR:-값}` 형식)로 덮어씁니다. `CLAUDE_CONFIG_DIR`도 따릅니다(launchd plist에는 설치 때의 값이 기록됩니다).
- `MARU_SKILL_AUTOINSTALL=1`(선택, 기본 꺼짐): install.sh가 `~/.claude/CLAUDE.md` 블록에 "에이전트가 검토 후 문제없으면 직접 설치하고 알린다"는 문구를 씁니다. **위험**: 세션에 주입된 텍스트(웹페이지·붙여넣은 문서)가 스킬 제안으로 흘러들어 사용자 승인 없이 설치되면, 그 스킬은 모든 프로젝트에서 로드됩니다. 켜기 전에 이 위험을 이해하고 설치 후 `install.sh`를 다시 실행하세요.

## 텔레그램으로 지시하기
폰의 텔레그램에서 봇에게 말하면 맥에서 도는 마루가 받아 일하고 같은 대화방으로 답합니다. Claude Code의 **채널(channels)** 기능(연구 미리보기)을 쓰며, `scripts/telegram.sh`가 tmux 안에서 상시 세션을 관리합니다. 근거: https://code.claude.com/docs/en/channels.md , https://code.claude.com/docs/en/channels-reference.md , https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram

### 요구사항
- Claude Code 2.1.x, claude.ai 로그인(Pro/Max 개인은 바로 사용, Team/Enterprise는 관리자가 채널을 켜야 함) 또는 Console API 키. Bedrock·Vertex·Foundry는 불가.
- `bun`(텔레그램 플러그인이 Bun 스크립트. 최소 버전은 문서에 명시 없음), `tmux`, `caffeinate`(macOS 기본). **스크립트는 아무것도 설치하지 않습니다.** 직접 설치: `brew install tmux oven-sh/bun/bun`

### 1회 설정 (모두 사용자가 직접)
1. 텔레그램에서 [BotFather](https://t.me/BotFather)에 `/newbot` → 이름과 `...bot`으로 끝나는 사용자명을 정하고 토큰을 받는다. **토큰은 남에게 보이지 않게 다룬다.**
2. 플러그인을 **maru 폴더 전용(local 범위)** 으로 설치한다: `cd ~/maru && claude plugin install telegram@claude-plugins-official --scope local`(marketplace 오류는 `/plugin marketplace add anthropics/claude-plugins-official`). **user 범위로 설치하지 마세요.** user 범위는 모든 Claude 세션이 텔레그램 서버를 띄워, 연결이 실패하거나 여러 세션이 같은 봇을 동시에 폴링할 수 있습니다. local 범위는 gitignore된 `.claude/settings.local.json`에 기록되어 저장소를 받은 다른 사람에게 강제되지 않습니다(`telegram.sh`는 maru 폴더에서 `claude plugin list`로 범위를 확인하고 user 범위면 시작을 거부합니다). 이미 user 범위로 설치했다면 `claude plugin uninstall telegram@claude-plugins-official --scope user` 후 위 명령을 실행하세요.
3. `cd ~/maru && claude`에서 `/telegram:configure <토큰>`을 직접 입력한다. 토큰은 `~/.claude/channels/telegram/.env`에 저장된다(저장소 밖). 이 저장소·`data/`에는 두지 않으며 스크립트는 이 파일을 읽지 않는다.
4. `claude`를 끝내고 `scripts/telegram.sh start` 후 `scripts/telegram.sh attach`로 화면을 본다(빠져나오기 `Ctrl-b d`). 페어링 전에는 시작 때 경고가 크게 뜹니다(정책이 pairing인 동안 봇에 말을 건 누구에게나 코드가 나감).
5. 텔레그램에서 봇에게 아무 메시지나 보내면 페어링 코드가 온다. attach한 화면에서 `/telegram:access pair <코드>`, 이어서 `/telegram:access policy allowlist`로 본인만 허용한다. 접근 목록은 `~/.claude/channels/telegram/access.json`(`dmPolicy`, `allowFrom`).
6. (선택) 로그인 때 자동 시작: `./install.sh --with-telegram`. 위 5단계(allowlist + 허용 발신자 1명 이상)가 끝나기 전에는 등록을 거부합니다.

### 시작·중지
```
scripts/telegram.sh start                # tmux 세션 maru-telegram 에서 claude --channels plugin:telegram@claude-plugins-official --permission-mode <모드> (caffeinate -i 로 감쌈)
scripts/telegram.sh start --unattended   # LaunchAgent용: allowlist + 허용 발신자 1명 이상이 아니면 시작 거부
scripts/telegram.sh status               # 실행 여부, 시작 시각, 접근 설정, 막힌 화면(로그인 만료·신뢰/동의 대기·미설정) 감지, 화면 마지막 줄
scripts/telegram.sh attach               # 화면 붙기 (Ctrl-b d 로 분리. 안에서 /exit 하면 세션 종료)
scripts/telegram.sh logs [N]             # 최근 N줄(기본 100)을 화면에 출력. 파일로 저장하지 않음
scripts/telegram.sh stop                 # claude·bun 폴러·caffeinate 까지 프로세스 트리 전체를 끝내고 남은 것이 없는지 확인
```
비정상 종료하면 백오프(10초·20초·40초…최대 5분) 후 자동 재시작하고, 1시간에 5회(`MARU_TELEGRAM_MAX_RESTARTS`)를 넘으면 멈추고 macOS 알림을 띄웁니다. `/exit` 같은 정상 종료나 `stop`은 되살리지 않습니다. 세션은 떠 있지만 로그인 만료·동의 화면 등에서 멈춰 있는 경우는 시작 직후와 `status`에서 알려 주고, 자동 시작이면 macOS 알림도 보냅니다. **LaunchAgent는 사용자가 로그인한 뒤에만 시작**되므로 재부팅 후 로그인 화면에서는 동작하지 않습니다.

### 권한 모드 (중요한 트레이드오프)
`data/maru.conf`의 `MARU_TELEGRAM_PERMISSION_MODE`(기본 `default`)로 정하고, 항상 `--permission-mode`로 명시해 넘기므로 사용자의 전역 기본 모드가 암묵적으로 적용되지 않습니다. 허용 값은 아래 4개뿐이며 그 외(`bypassPermissions`, `dontAsk`, 빈 값 등)는 거부합니다. `--dangerously-skip-permissions`는 쓰지 않습니다. `start`를 다시 해야 바뀝니다. 이 세션은 홈 전체에 접근할 수 있고 허용된 텔레그램 발신자의 말이 곧 지시라는 점을 전제로 고르세요.
- `default`: 도구 사용 승인 프롬프트마다 **세션이 멈추고 맥의 터미널에서 답할 때까지 기다립니다.** 채널 서버가 permission relay를 지원하면 채팅으로도 승인할 수 있지만 Telegram 플러그인이 지원하는지는 문서에 없습니다(**미확인**). 가장 안전하지만 폰만으로는 거의 일을 못 합니다.
- `acceptEdits`: 파일 편집은 자동 승인, 셸 명령 등은 여전히 멈춤.
- `plan`: 계획만 세우고 실행하지 않음(읽기 전용 조사용).
- `auto`: 내장 분류기가 일상적인 작업을 묻지 않고 승인합니다. 자리를 비워도 쓸 만하게 만드는 값이지만, 분류기가 틀리거나 악성 지시가 섞이면 승인 없이 실행될 위험을 감수한다는 뜻입니다.
이 맥의 `data/maru.conf`에는 `MARU_TELEGRAM_PERMISSION_MODE=${MARU_TELEGRAM_PERMISSION_MODE-auto}`처럼 `VAR=${VAR-값}` 형식으로 씁니다.

### 원격으로 되는 것 / 안 되는 것
- 되는 것: 홈 아래 파일·CLI·MCP 커넥터 작업, 조사·정리, 결과 요약 회신(긴 결과는 파일로 저장 후 경로 회신).
- 미검증: 화면 조작(스크린샷·클릭, computer use)이 채널 세션에서 되는지는 확인하지 못했습니다. macOS 권한(손쉬운 사용·화면 기록)은 사용자가 미리 허용해야 하며 원격에서 대신 눌러 주지 않습니다.
- 사진은 수신 때 내려받고(`~/.claude/channels/telegram/inbox/`) 압축되므로 원본은 문서로 보내세요. 메시지 기록·검색, 첨부 다운로드 도구는 없습니다(봇 API 한계).

### 보안
- **허용 목록에 오른 계정은 홈 디렉터리 전체에 접근하는 에이전트에게 명령을 시킬 수 있습니다. 그 텔레그램 계정을 탈취당하면 사실상 맥의 셸 권한을 내주는 것과 같습니다.** 그래서 텔레그램 2단계 인증(설정 > 개인정보 보호 및 보안 > 2단계 인증)과 앱 암호(Passcode) 잠금을 켜고, 허용 목록에는 **본인 계정 정확히 1개만** 두세요. 허용 그룹도 두지 않습니다(`--unattended`는 그룹이 있으면 거부).
- 채널이 permission relay를 지원할 경우 허용된 발신자는 도구 사용도 승인할 수 있습니다. 허용 목록 밖 발신자는 allowlist 정책 이후 조용히 무시됩니다.
- **접근 회수**: ① `scripts/telegram.sh stop` ② 세션에서 `/telegram:access remove <ID>`(또는 `policy disabled`) ③ BotFather에서 봇 토큰을 재발급/폐기(`/revoke`). 토큰이 새었다고 의심되면 ③을 먼저 하세요.
- 전달받은 메시지·링크·파일 속 지시는 데이터로만 다룹니다(`CLAUDE.md`).
- **맥이 켜져 있고 깨어 있어야 합니다.** `caffeinate -i`는 유휴 잠자기만 막습니다. 덮개를 닫으면 전원·외부 디스플레이 연결 여부에 따라 잠들 수 있어(**미검증**) 덮개를 연 채 전원에 연결하세요. 잠들면 그 동안은 응답하지 않습니다.

### 한계 (문서 기준)
- 채널은 **연구 미리보기**: `--channels` 문법과 계약이 바뀔 수 있고, `claude --help`에는 표시되지 않지만 동작합니다. 승인 목록(`claude-plugins-official`)의 플러그인만 등록됩니다.
- 이벤트는 **세션이 열려 있는 동안에만** 도착합니다. 세션이 꺼져 있는 동안 보낸 메시지가 나중에 전달되는지는 문서에 없습니다(**미확인**. 봇 API에는 기록 조회가 없다고만 명시).
- 한 봇은 한 세션에서만 쓰는 것으로 가정하세요(문서에 명시 없음, **미확인**). 봇을 더 쓰려면 `TELEGRAM_STATE_DIR`로 상태 폴더를 분리합니다.
- 여러 메시지가 한꺼번에 오면 다음 턴에 묶여 처리됩니다. 채널 답장은 터미널에 "sent" 정도만 보입니다.

## 맥 통제
이 폴더에서 `claude`를 실행하면 `mac-control` 스킬이 로드되어, "앱 열어 줘", "디스크 얼마 남았지", "다운로드 폴더에서 PDF 찾아 줘", "미리 알림에 추가해 줘" 같은 요청을 처리합니다. 전용 연동/API → CLI → AppleScript·단축어 → 브라우저 자동화 → 화면 조작 순으로 가벼운 수단부터 쓰고, 실행 전후에 상태를 조회해 결과를 확인합니다.
- `scripts/mac-inventory.sh`: 설치 앱(번들 ID, 스크립트 지원 여부)·brew·단축어·CLI 도구를 `data/mac-inventory.md`에 기록합니다(읽기 전용, 앱 실행·권한 요청 없음, 시리얼·계정·네트워크 식별자 제외). 일주일이 지나면 에이전트가 다시 돌립니다.
- 앱별 요령은 `.claude/skills/mac-control/reference/apps/`에 쌓이며 일반 지식만 담습니다.
- **사용자가 직접 켜야 하는 권한**(시스템 설정 > 개인정보 보호 및 보안): 자동화(Finder·Safari·캘린더 등 앱별, 실행 주체 앱 단위), 손쉬운 사용(UI 스크립팅·키 입력), 화면 및 시스템 오디오 기록(스크린샷), 전체 디스크 접근(Mail·Messages·Safari 데이터 등). 필요한 순간 에이전트가 어느 항목·어느 앱인지 알려 줍니다. 대신 눌러 주지 않습니다.
- **수동으로 남는 것**: 영구 삭제, 사용자 명의 발신, 결제·주문, 시스템·보안 설정 변경, 비밀번호·토큰 입력은 사용자가 직접 하거나 매번 확인을 받습니다. 삭제는 휴지통 이동이 기본입니다.

## 모델 배분
메인 세션은 `.claude/settings.json` 의 `"model": "sonnet"` 으로 빠르게 접수·단순 처리하고, 어려운 일은 `.claude/agents/` 의 서브에이전트로 나눕니다: `scout`(haiku, 읽기 전용 찾기·조사), `worker`(sonnet, 절차가 정해진 여러 단계 작업), `expert`(opus, 되돌리기 어려운 결정·원인 분석·민감한 변경 리뷰). 기준은 CLAUDE.md 「위임 원칙」.
메인 모델은 세션 중 스스로 바꿀 수 없으므로 `/model` 로 사용자가 바꾸거나 `claude --model` 로 덮어쓸 수 있습니다. 끄려면 settings.json 의 `model` 줄을 지우면 됩니다(서브에이전트 정의는 `.claude/agents/` 를 지우거나 그대로 두어도 무해). 모두 구독 사용량 안에서만 동작하며 별도 과금은 없습니다.

## maru 명령과 cmux Dock
- `bin/maru` 런처: `maru`(저장소에서 claude 실행), `maru ui`, `maru suggest [번호]`, `maru status`, `maru log [reflect|dream]`, `maru hist ...`, `maru doctor`(읽기 전용 점검), `maru help`. 런처 자체는 아무것도 설치·수정하지 않습니다. PATH 등록은 `./install.sh --with-cli` 로 합니다(심볼릭 링크를 따라 저장소 위치를 계산).
- `maru ui`(`scripts/maru_ui.py`, 파이썬 표준 라이브러리 curses, 네트워크·포트 없음): 40~60열 좁은 폭용 상황판. 탭 1 상태(30초 자동 갱신, `r`) / 2 기억(Enter 본문, `/` 필터) / 3 로그(`l` reflect·dream 전환) / 4 제안 / 5 추천. `--once`는 상태를 평문으로 출력하고 `--selftest`는 임시 디렉터리에서 로직을 검증합니다.
- 제안 설치는 제안 탭에서 보기를 열고 설치될 `SKILL.md`(PROPOSAL.md 보다 먼저 표시)를 끝까지 스크롤한 뒤 `i`, 정확히 `yes` 를 입력해야만 진행됩니다. 보기를 열 때 `SKILL.md` 를 한 번 읽어 스냅샷으로 고정하고 표시·설치는 그 바이트만 쓰며, 설치 직전 디스크의 sha256 이 다르면 거부합니다. 읽기는 `O_NOFOLLOW`+일반 파일·링크 수 1·100KB 이하만 허용합니다. 이름 정규식(전체 일치)·frontmatter `name` 이 디렉터리 이름과 같을 것·`name`/`description`/`argument-hint`(한 줄·100자 이하·제어 문자 없음일 때만) 외 frontmatter 키 거부(파싱 불가도 거부)·저장소 `.claude/skills` 이름 충돌 거부·기존 스킬 덮어쓰기 거부·숨김/제어 문자·잘못된 UTF-8 거부를 거치며 `SKILL.md` 만 복사합니다. `maru hist` 는 `--output`·`--ext-diff`·`--textconv`·`-c`·`-C`·`--git-dir`·`--work-tree`·`--exec-path` 인자를 거부합니다. `x` 는 삭제 없이 `data/skill-proposals/.rejected/` 로 옮깁니다. 제안 내용은 신뢰할 수 없는 데이터로 표시만 합니다.
- 추천 요청: 회고·새벽 정리의 모델이 stage 폴더에 `suggestions.txt` 를 쓰면 셸(`lib.sh` 의 `apply_suggestions`)이 검증해 `data/suggestions.txt` 로 원자적 교체합니다(일반 파일만·64KB 이하·최대 8줄·줄당 120자 이하·제어/bidi/zero-width 문자 줄 제거·중복 제거, 실패하면 기존 목록 유지, 기억 트랜잭션과 독립이며 실패해도 로그만 남김). 보는 곳은 Dock 의 5 추천 탭(↑↓, Enter/`c` 로 클립보드 복사)과 `maru suggest`(목록), `maru suggest <번호>`(복사)입니다. **복사만 하고 절대 전송하지 않습니다**: 붙여넣고 내용을 확인한 뒤 직접 Enter 를 누르세요. cmux 의 다른 서피스로 직접 넣는 기능은 지원하지 않습니다(`cmux send` 가 텍스트의 `\n` 을 Enter 로 해석하고 대상이 기본적으로 호출한 서피스라서).
- Claude Code 내장 프롬프트 추천(답변 뒤 회색 글씨, Tab/→ 로 채움, `promptSuggestionEnabled`)은 Claude Code 기능이라 내용을 조정할 수 없습니다. maru 의 추천은 위의 Dock 탭/`maru suggest` 와, 반복 요청을 `/스킬이름` 으로 부르게 하는 스킬 제안(필요하면 `argument-hint`)으로 제공됩니다.
- cmux Dock: `./install.sh --with-cmux` 가 `~/.config/cmux/dock.json` 을 설치하면 우측 Dock 에서 `maru ui` 가 실행됩니다(cmux 에서의 실제 표시는 미검증). Dock 의 PATH 에 `maru` 가 없어도 되도록 설치 시점의 저장소 `bin/maru` 절대 경로를 직접 부릅니다. `cmux/dock.json` 은 `$HOME/maru` 가정의 예시 원본이며 설치는 `maru_config.py dock-gen` 이 만든 내용을 씁니다.
- 미검증: 실제 cmux Dock 안에서의 동작, 제안 설치·거절의 화면 조작(로직은 `--selftest` 로만 검증), `maru hist`(Xcode 라이선스 미동의 환경에서는 git 이 실패할 수 있음).

## 구조
```
CLAUDE.md          에이전트 정체성과 규칙 (개인 정보 없음)
scripts/           reflect.sh dream.sh telegram.sh mac-inventory.sh lib.sh(설정·도구 해석) launchd.sh test-env.sh digest.py hist maru_config.py maru-status.sh maru_ui.py
bin/maru           런처(ui status log hist doctor)
cmux/              dock.json 등 cmux 연동
prompts/           회고·정리 프롬프트 템플릿 ({{MEMORY_DIR}} 등 자리표시자)
launchd/           plist 템플릿 (설치 때 경로 치환)
.claude/skills/    recall 스킬, mac-control 스킬(SKILL.md + reference/ cli·applescript·apps)
data/              개인 데이터 (gitignore): state logs digests skill-proposals stage history.git backups maru.conf
```
- 코드는 `MARU_HOME`(스크립트 위치 기준), 개인 데이터는 `MARU_DATA`(기본 `$MARU_HOME/data`)에 둡니다. 설정은 `scripts/lib.sh` 상단 한 곳이며 환경변수 또는 `data/maru.conf`로 덮어씁니다.
- **기억 위치**: Claude Code의 자동 기억 폴더 `~/.claude/projects/<슬러그>/memory/`. 슬러그는 `MARU_HOME`의 실제 경로에서 영숫자가 아닌 문자를 `-`로 바꾼 값입니다(예: `/Users/me/maru` → `-Users-me-maru`). 그래서 `~/maru`에서 `claude`를 실행하면 색인이 자동으로 로드됩니다.
- **변경 이력**: `scripts/hist`는 기억 폴더만 추적하는 별도 git 저장소(`data/history.git`)를 감쌉니다. `scripts/hist log`. 이 저장소(`.git`)는 코드만 추적합니다.

## 보안 모델과 한계
헤드리스 회고/정리 실행은 `--permission-mode dontAsk` + 허용 목록으로 제한됩니다.
- 읽기: 이번 다이제스트, 기억 폴더, 그리고 `data/skills-view/`(스킬의 `SKILL.md` 복사본. 실제 디렉터리이고 realpath가 스킬 폴더 안인 것만, 매 실행마다 새로 만듦)만. 원본 스킬 폴더는 읽지 못하므로 그 안의 심볼릭 링크로 밖을 읽을 수 없습니다. 홈의 다른 파일, `settings.json`, 이 저장소의 코드는 거부됩니다. 한계: 기억 폴더 안에 심볼릭 링크가 있으면 따라갈 수 있으므로 기억 폴더에는 링크를 두지 마세요.
- 쓰기: 기억 폴더와 `data/stage/`(스킬 제안 임시 폴더)만. Bash·웹 도구는 없습니다.
- 실행 cwd는 저장소 밖의 빈 폴더(`~/.maru-work`)입니다. 저장소 안이면 프로젝트 설정(홈 접근)이 적용되어 제한이 무력화됩니다.
- 모델 호출 직전에 기억 폴더를 복사하고 파일별 체크섬 목록(A)을 만들며, 호출 직후 목록(B)을 만듭니다. 실패하거나 검증(색인 일관성·파일 수 급감 등)에 걸리면 **diff(A,B), 즉 이번 실행이 바꾼 경로만** 되돌리므로 그 밖에 다른 세션이 쓴 파일은 보존됩니다. 삭제는 모델이 `data/stage/delete.txt`에 적고 스크립트가 가드(색인·링크 확인, 개수 한도)를 거쳐 수행합니다(회고·정리 공통).
- 스킬 제안은 파일로만 남고, 이름·크기 검증을 거칩니다.

한계: 되돌림에는 남는 경합이 있습니다. 모델이 도는 동안(수십 초) 다른 세션이 **같은 파일**을 고치면 그 변경도 이번 실행의 것으로 보고 되돌립니다. 대화 내용의 프롬프트 인젝션을 완전히 막지는 못합니다(기억에 잘못된 사실이 들어갈 수 있음). 방어는 "사용자 발화만 근거로 삼기" 지침과 권한 제한, 변경 이력(`hist`)을 통한 사후 확인입니다. 총괄 에이전트(`claude` 직접 실행)는 홈 전체에 접근할 수 있으므로 일반 Claude Code 권한 설정으로 통제하세요. 실행 환경 비밀값은 다이제스트에 들어갈 수 있으니 기억을 공유·공개하지 마세요.

## 구독 정책 의존성 고지
이 프로젝트는 개인 Claude 구독 로그인으로 `claude -p`를 자동(훅·launchd)으로 호출합니다. 구독 약관·사용 정책과 요금제 한도는 변할 수 있고, 자동 호출이 허용되는지는 사용자가 직접 확인해야 합니다. 로그인이 만료되면 회고는 실패하며(연속 2회 실패 시 macOS 알림) `claude auth login` 또는 `claude setup-token`이 필요합니다. 동작은 Claude Code 버전(검증: 2.1.x)의 권한 규칙·옵션에 의존합니다.

## 라이선스
**아직 정하지 않았습니다.** LICENSE 파일이 없으므로 현재는 모든 권리가 저자에게 있습니다.

## 공개 전 할 일
- 커밋 작성자 정체성: 지금은 임시 값(`maru <maru@localhost>`)입니다. 공개용 이름·이메일을 정하고 이력을 다시 쓰세요.
- LICENSE 선택.
- `git grep -n -i`로 개인 정보(이름·경로·회사명)가 없는지 마지막으로 확인.
