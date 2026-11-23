# 마루 (maru) 운영 설명서

> 이 문서는 지금은 한국어로만 제공합니다. 프로젝트 소개와 설치 안내는 [README](../README.md)([한국어](../README.ko.md))를 보세요.

Claude Code 위에서 도는 **개인 총괄 에이전트**입니다. 이 폴더에서 `claude`를 실행하면 마루가 되고, 쓸수록 사용자에 맞춰지도록 대화를 회고해 장기 기억을 쌓습니다.

- **회고(학습 루프)**: 세션이 끝날 때(SessionEnd 훅) 제한된 권한의 헤드리스 `claude -p`가 대화 요약을 읽고 기억 파일을 갱신합니다.
- **정기 정리(dream)**: 매일 03:30 launchd 작업이 놓친 세션을 회고하고 기억을 정리합니다.
- **스킬 제안**: 반복되는 절차는 `data/skill-proposals/`에 제안으로만 쌓입니다. 기본값에서는 에이전트가 제안 내용을 한 줄로 알리고 사용자가 명시적으로 승인한 뒤에만 설치합니다(아래 `MARU_SKILL_AUTOINSTALL` 참고).
  - 절차를 담은 제안에는 본문에 `## 완료 확인` 절(영어는 `## Done checks`)이 들어가도록 회고에 지시합니다. 항목은 3~7개이며 실행 결과·개수·링크·참조 파일과의 대조처럼 모델의 의견 밖 증거로 확인할 수 있는 것만 적고, 확인하지 못한 항목은 통과로 치지 않습니다. 제안 폴더의 `PROPOSAL.md` 에 `- 완료 확인 절: 있음/없음` 이 적히며, 절이 없어도(요령 모음 같은 지식형 스킬) 제안은 거부되지 않습니다.
  - 설치된 스킬로 만든 결과를 사용자가 고쳤고 그 교정이 스킬의 절차·기준에 관한 것이면, 회고는 feedback 기억 대신 그 스킬의 최소 수정안(필요하면 완료 확인 항목 하나 추가)을 같은 제안함에 올립니다. 스킬과 무관한 일반 선호는 기억으로 갑니다. 이를 판단하도록 다이제스트에는 슬래시 명령 이름만 `[스킬 /이름]` 한 줄로 남고 인자·본문은 남지 않습니다.
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
설치가 하는 일(경로에 공백이 있어도 동작): `data/`와 기억 폴더 생성 / `~/.claude/settings.json`에 훅 4개 등록: SessionEnd(회고) · SessionStart(최근 일지 로드) · Stop/PreCompact(세션 도중 일지) (수정 전 `data/backups/`에 타임스탬프 백업. 파일 전체를 JSON으로 읽어 다시 쓰므로 **파일이 재작성된다**: 키 순서·알 수 없는 필드·다른 훅의 위치는 보존하고 들여쓰기 형식을 유지하며 임시 파일 + rename으로 원자적으로 쓰지만, 주석처럼 JSON 밖의 서식은 보존되지 않는다) / launchd 작업 `com.maru.dream` 등록 / `recall` 스킬을 `~/.claude/skills/recall`에 복사(`.maru` 표식 파일을 넣고, 표식 없는 기존 `recall`은 건드리지 않음) / `.claude/settings.local.json`에 홈 디렉터리 접근 허용 / `~/.claude/CLAUDE.md`에 `<!-- maru:begin -->`…`<!-- maru:end -->` 블록 유지.

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

### 폰에서 이어서 하기 (원격)
앱 터미널 위 막대의 오른쪽에 「원격」 스위치가 있습니다. 켜면 지금 보고 있는 세션을 Claude 모바일 앱이나 claude.ai/code 에서 이어서 쓸 수 있습니다. 메뉴 터미널 > 「원격 켜기/끄기」로도 같은 동작을 합니다. 텔레그램과 달리 새 세션이 아니라 지금 이 세션이 그대로 폰에 연결됩니다.
- 앱이 하는 일: 세션 입력줄에 `/remote-control` 을 대신 입력하고 Enter 를 누릅니다. 이 명령 외에는 아무것도 보내지 않습니다. 끌 때도 같은 명령을 한 번 더 보냅니다. 터미널에 직접 `/remote-control` 을 입력해도 같은 결과입니다.
- 필요한 것: claude.ai 계정으로 로그인한 Claude Code 와 열려 있는 마루 앱. 공식 문서에 따르면 연결이 유지되는 동안 맥이 깨어 있어야 합니다. 앱을 닫거나 맥이 잠들었을 때 앱이 하는 처리는 없습니다.
- 처음 켤 때 Claude Code 가 터미널에서 확인을 물을 수 있습니다. 앱은 대신 답하지 않으므로 터미널에서 직접 답하세요. 끌 때 상태 창이 뜨면 그것도 터미널에서 답합니다.
- 연결되어 있는 동안 이 대화는 Anthropic 서버에도 저장됩니다. 민감한 작업 중에는 켜기 전에 확인하세요.
- 표시되는 상태는 확인된 것만 반영합니다. 근거는 훅 기록입니다. 훅 기록은 프롬프트 제출, 도구 사용, 응답 종료, 권한 요청 알림 등 모든 훅 이벤트마다 쓰이므로, 요청 뒤 첫 이벤트에서 확인됩니다. 켜 달라고 요청한 직후 5분 안에는 터미널에 나타나는 「/remote-control is active」 문구도 근거로 받습니다. 그래서 켠 직후에는 「연결 중…」이 보이고, 확인되면 「원격 켜짐」으로 바뀝니다. 왼쪽 목록에서는 연결된 세션에 「원격」 표시가 붙습니다.
- 한계: 터미널 문구는 누구나 출력할 수 있는 글자이므로 앱의 요청 없이 나타난 것은 근거로 받지 않습니다. 그래서 터미널에 직접 `/remote-control` 을 입력해 켠 경우에는 다음 훅 기록이 쓰인 뒤에야 「원격 켜짐」으로 표시됩니다.
- 「원격 확인 중」은 요청을 보낸 지 60초가 지나도 확인된 결과가 없다는 뜻입니다. 이 상태에서는 누르기를 거부하고 아무것도 입력하지 않습니다. 다음 대화가 오가면 훅 기록으로 확인됩니다. 바로 확인하려면 터미널에 `/remote-control` 을 직접 입력하세요.
- 보내지 않는 경우: 에이전트가 작업 중일 때(권한이나 질문 창이 훅 기록보다 먼저 떠 있을 수 있어서), Claude 가 허용 여부를 묻는 중일 때, 출력이 막 나온 직후일 때, 셸 화면이거나 Claude 세션이 아닐 때, 입력줄에 쓰던 글이 있을 때. 이때는 이유를 알려 주는 안내만 뜨고 아무것도 입력하지 않습니다.
- 입력줄 확인은 추측입니다. 마지막 Enter, Ctrl+C, Ctrl+U 뒤에 키를 눌렀으면 글이 있다고 보므로, 입력줄이 비어 있어도 거부할 수 있습니다. 이 경우 Ctrl+U 로 비운 뒤 다시 누르세요.

### 하위 세션과 설계 문서
앱 작업 공간 안의 마루는 `maru open <폴더> [--project 태그/슬러그] [--squad slug]` 로 프로젝트 폴더에 하위 세션을 열어 브리핑(표준입력)을 넘길 수 있고(`--squad` 는 맡을 팀: 아래 「스쿼드」 참고), 하위 세션의 결과는 보고 파일(`data/state/app/reports/`)로 남아 사용자의 다음 메시지 때 마루에게 전달됩니다(미검증 데이터로 표시, 서명된 요청만, 앱이 매번 브리핑 전체를 사용자에게 보여 주고 확인받은 뒤 엽니다. `MARU_REQ_KEY` 는 같은 macOS 사용자 안에서는 비밀이 아니며 진짜 관문은 앱 안의 사용자 동의입니다)(Stop 훅이 쓰고 UserPromptSubmit 훅 `scripts/child-reports.sh` 가 읽음). 프로젝트마다 `data/projects/<태그>/<슬러그>/design.md` 설계 문서가 사실·결정의 기준(권한은 주지 않음)이며 `maru project doc|docs` 로 봅니다. 회고는 검증을 통과한 경우에만 문서를 갱신하고(이전 버전은 `maru hist design log`), 새벽 정리는 건드리지 않습니다. 요청·보고·초기 프롬프트 파일은 모두 `data/state/app/` 아래 모드 600/700 이며 링크는 따라가지 않습니다.
키보드로는 ⌘⇧↑·⌘⇧↓ 로 왼쪽 목록의 위·아래 대상으로 옮겨 갑니다(작업 공간 다음은 프로젝트로 이어지고, 맨 처음과 맨 끝에서는 멈춥니다). Claude Code 입력란에 `->`, `<-`, `<->` 를 치면 →, ←, ↔ 로 바뀝니다(바뀐 직후 Backspace 를 누르면 원래 글자로 돌아갑니다. 붙여넣은 글은 바꾸지 않습니다). ⌘⇧← 는 지금 보고 있는 대상의 묶음을 접고 ⌘⇧→ 는 펼칩니다(작업 공간이면 하위 세션 묶음, 프로젝트 상세를 보고 있으면 그 카테고리). 입력란에서는 ⌘↑·⌘↓ 가 입력 전체의 맨 앞·맨 끝으로, ⌘←·⌘→ 가 줄의 맨 앞·맨 끝으로 커서를 옮깁니다.

작업 공간 목록의 행(마루·하위 세션 포함)을 우클릭하면(행의 버튼에 포커스를 두고 Shift+F10 도 됩니다) 「이름 변경」·「제거」 메뉴가 뜹니다. 이름 변경은 그 자리에서 입력칸으로 바뀌어 Enter 로 확정, Esc 로 취소하고(1~40자, 다른 작업 공간과 겹치면 뒤에 " 2" 가 붙습니다) 정한 이름은 다시 켜도 유지됩니다. 제거는 단추 ×·⌘W 와 같은 닫기입니다(실행 중이면 확인 창이 뜹니다). 행은 끌어서 놓거나 ⌥↑/⌥↓ 로 같은 단계(최상위끼리, 한 마루 아래 하위 세션끼리) 안에서 순서를 바꿀 수 있고, 바꾼 순서는 다시 켜도 유지됩니다. 보고 있지 않은 동안 에이전트가 턴을 마치거나 사용자 입력을 기다리게 되면 그 행의 상태 글자 왼쪽에 작은 주황 점이 생기고 제목이 굵어지며, 그 작업 공간을 열거나(창이 뒤에 있었다면 창을 다시 앞으로 가져와 그 작업 공간이 열려 있을 때) 점이 사라집니다. 점은 저장되지 않아 다시 켜면 없습니다.
마루가 요청하지 않아도 사용자가 직접 하위 세션을 열 수 있습니다: 작업 공간 목록의 마루 줄에 있는 「+ 하위」 단추(또는 메뉴 작업 공간 > 하위 세션 열기…)로 폴더(앱의 폴더 선택창)·제목·맡길 내용(비워도 됨)·팀을 정해 열면, 마루가 요청한 하위 세션과 같은 방식으로(같은 개수·횟수 한도, 같은 계층·보고·이어 열기) 시작합니다. 「마루에게 알리기」를 켜 두면 마루의 입력줄에 열었다는 한 줄이 채워지고 Enter 는 직접 누릅니다(마루가 일하는 중이면 건너뜁니다).

## 맥 통제
이 폴더에서 `claude`를 실행하면 `mac-control` 스킬이 로드되어, "앱 열어 줘", "디스크 얼마 남았지", "다운로드 폴더에서 PDF 찾아 줘", "미리 알림에 추가해 줘" 같은 요청을 처리합니다. 전용 연동/API → CLI → AppleScript·단축어 → 브라우저 자동화 → 화면 조작 순으로 가벼운 수단부터 쓰고, 실행 전후에 상태를 조회해 결과를 확인합니다.
- `scripts/mac-inventory.sh`: 설치 앱(번들 ID, 스크립트 지원 여부)·brew·단축어·CLI 도구를 `data/mac-inventory.md`에 기록합니다(읽기 전용, 앱 실행·권한 요청 없음, 시리얼·계정·네트워크 식별자 제외). 일주일이 지나면 에이전트가 다시 돌립니다.
- 앱별 요령은 `.claude/skills/mac-control/reference/apps/`에 쌓이며 일반 지식만 담습니다.
- **사용자가 직접 켜야 하는 권한**(시스템 설정 > 개인정보 보호 및 보안): 자동화(Finder·Safari·캘린더 등 앱별, 실행 주체 앱 단위), 손쉬운 사용(UI 스크립팅·키 입력), 화면 및 시스템 오디오 기록(스크린샷), 전체 디스크 접근(Mail·Messages·Safari 데이터 등). 필요한 순간 에이전트가 어느 항목·어느 앱인지 알려 줍니다. 대신 눌러 주지 않습니다.
- **수동으로 남는 것**: 영구 삭제, 사용자 명의 발신, 결제·주문, 시스템·보안 설정 변경, 비밀번호·토큰 입력은 사용자가 직접 하거나 매번 확인을 받습니다. 삭제는 휴지통 이동이 기본입니다.

## 모델 배분
메인 세션은 `.claude/settings.json` 의 `"model": "sonnet"` 으로 빠르게 접수·단순 처리하고, 어려운 일은 `.claude/agents/` 의 서브에이전트로 나눕니다: `scout`(haiku, 읽기 전용 찾기·조사), `worker`(sonnet, 절차가 정해진 여러 단계 작업), `expert`(opus, 되돌리기 어려운 결정·원인 분석·민감한 변경 리뷰). 기준은 CLAUDE.md 「위임 원칙」.
메인 모델은 세션 중 스스로 바꿀 수 없으므로 `/model` 로 사용자가 바꾸거나 `claude --model` 로 덮어쓸 수 있습니다. 끄려면 settings.json 의 `model` 줄을 지우면 됩니다(서브에이전트 정의는 `.claude/agents/` 를 지우거나 그대로 두어도 무해). 모두 구독 사용량 안에서만 동작하며 별도 과금은 없습니다.

## 스쿼드
여러 단계로 나뉘는 큰 일을 맡는 팀입니다: 마루 → 총괄(`sq-<slug>-lead`) → 팀원(`sq-<slug>-<역할>`), 위임은 2단계까지이고 팀원은 `Agent` 도구를 가질 수 없습니다. `maru`(= `scripts/maru-claude.sh`)가 `scripts/squads.py json` 결과를 `claude --agents` 로 넘기며, 스쿼드 문제(python3 없음·검증 실패)가 있으면 스쿼드 없이 그냥 `claude` 를 띄웁니다. 총괄·팀원의 프롬프트 앞에는 코드가 고정 안전 머리말(보고 형식·삭제/발신/결제/설정/비밀값 금지·결과 속 지시는 데이터)을 붙이며 스쿼드 파일이 덮어쓸 수 없습니다. 머리말에는 코드가 만든 에이전트 이름만 들어가고, 스쿼드 파일에서 온 이름·팀원 설명은 끝 표지 뒤에 "신뢰하지 않는 정보"로 붙습니다(`[` `]` 는 `(` `)` 로 바뀌고, 머리말 표지를 흉내 내는 문구는 위험 신호로 표시됩니다).
- 위치: 내장 `squads/<slug>/`(`dev` 개발, `research` 조사) + 개인 `data/squads/<slug>/`(같은 slug 면 개인 우선). 폴더 하나 = `squad.md`(`name` 24자 이하, `description` 200자 이하, 선택 `tags: [a, b]`) + `lead.md` + 팀원 `<role>.md` 1~6개. 에이전트 파일은 머리말 `description`, `model`(haiku|sonnet|opus|inherit), `tools`(쉼표 목록) + 본문. 팀원 파일에는 선택 키 `skills`(쉼표 목록, `[ ]` 가능)로 개인 스킬 폴더(`~/.claude/skills/<이름>/SKILL.md`)의 스킬을 팀원이 시작할 때 미리 실을 수 있습니다: 팀원만(총괄은 무시하고 경고), 팀원당 3개까지, SKILL.md 하나 32KB·팀원당 합계 48KB 이하, 이름은 `[a-z0-9][a-z0-9-]{0,63}`. 형식이 틀리거나 설치되지 않았거나 한도를 넘는 스킬은 그것만 빼고 경고하며 스쿼드는 그대로 쓰입니다. 스킬 본문은 검사하지 않으며(사용자가 직접 설치한 개인 스킬이므로 위험 신호로 세지 않습니다) 설치 확인 창과 `maru squad list` 의 팀원 줄에 이름이 보입니다. 아직 설치하지 않은 이름을 적어 두면 나중에 그 스킬을 설치했을 때부터 실립니다. slug·role 은 `[a-z0-9][a-z0-9-]{0,19}`. 링크 거부, 파일당 16KB, 스쿼드 12개, 전체 JSON 96KB(넘으면 뒤 스쿼드부터 제외), 허용 도구 밖 이름은 그 도구만 제외합니다.
- `maru squad [list]` 목록과 제외 사유 / `maru squad check <폴더>` 검증과 위험 신호(확인 없이·규칙 무시 문구, 팀원의 Bash·Write·Edit 등) 표시 / `maru squad install <폴더> [--replace] [--ack-warnings]` 개인 스쿼드로 설치(이미 있으면 `--replace`, 위험 신호가 있으면 `--ack-warnings` 필요) / `maru squad remove <slug>` 개인 스쿼드를 `data/squads-trash/` 로 이동(영구 삭제 아님) / `maru squad remove --proposal <slug>` 제안함(`data/squad-proposals/`)의 제안을 같은 휴지 폴더로 이동.
- 앱에서 스쿼드 만들기: 오른쪽 스쿼드 카드의 `+` 를 눌러 어떤 일을 맡길 팀인지 적으면(300자 이하, 예시 칩 제공) 앱이 정리한 한 줄을 마루 세션의 입력줄에 채웁니다(Enter 는 직접 눌러야 하고, 마루가 일하는 중이거나 입력줄이 준비되지 않았으면 이유를 알립니다). 앱은 스쿼드 파일을 쓰지 않습니다 — 마루가 초안을 만들어 '알림과 승인함'에 올리고, 사용자가 확인하고 승인해야 설치됩니다.
- 하위 세션의 팀: `maru open … --squad <slug>` 는 맡길 일에 맞는 설치된 스쿼드를 제안합니다(slug 형식은 스쿼드와 같고, 요청 서명에 들어가 전달 중에 바뀌면 거부됩니다; 팀을 안 주면 예전과 같은 서명 v1, 주면 v2). 앱의 확인 창에 "맡을 팀"(팀 없이 + 설치된 스쿼드, 제안된 것은 "마루 추천")이 보이고 사용자가 바꾸거나 뺄 수 있습니다. 고른 값은 앱이 승인하는 순간 설치 목록으로 다시 검증하며(없는 팀이면 열지 않고 다시 고르게 함), 앱이 환경변수 `MARU_CHILD_SQUAD=<slug>` 로 `maru-claude.sh` 에 넘기면 래퍼가 `squads.py session-agent <slug>` 로 그 slug 가 실제로 에이전트 JSON 에 담기는 스쿼드인지 물어, 맞을 때만 `claude --agent sq-<slug>-session` 으로 시작합니다(없거나 형식이 틀리면 무시하고 한 줄 안내 후 팀 없이 시작; 이 환경변수는 claude 에 넘기지 않음). `sq-<slug>-session` 은 그 세션의 메인 스레드가 되는 총괄로, 사용자가 그 세션에서 총괄과 직접 대화할 수 있고(확인이 필요한 일은 총괄이 사용자에게 직접 묻습니다) 워크트리 경로를 따로 주지 않아도 세션의 폴더에서 일합니다. 본문은 `lead.md` 와 같지만 `tools`·`model` 은 붙이지 않아 일반 세션의 기본값을 따르고, 서브에이전트로 부르는 용도가 아니므로 팀원 목록·`maru squad list`·앱의 팀원 줄에는 나타나지 않습니다. 역할 이름 `session` 과 `-lead`·`-session` 으로 끝나는 역할 이름은 다른 스쿼드의 에이전트 이름과 겹칠 수 있어 예약돼 있습니다. 팀원까지 돌아 사용량이 더 듭니다. 고른 팀은 작업 공간 기록(`workspaces.json`)에 남아 앱을 다시 켜 이어 열 때(`--resume`)도 같은 팀으로 시작하며(팀이 없어졌으면 팀 없이), 작업 공간 목록의 그 하위 세션 줄에 팀 이름표가 붙습니다. 프로젝트에 자체 에이전트·워크플로우가 있으면 팀을 주지 않습니다(마루 지침).
- 회고가 같은 종류의 여러 단계 작업이 반복된다고 보면 `data/squad-proposals/<slug>/` 에 초안을 제안합니다(한 실행 1개, 제안함 전체 10개 상한). 자동 설치는 없고 사용자가 `maru squad check` 로 검토해 승인한 뒤에만 설치합니다. 새 스쿼드는 다음에 `maru` 로 띄우는 세션부터 보입니다(텔레그램 상시 세션 등 `claude` 를 직접 띄우는 경로에는 붙지 않습니다). 시험: `scripts/test-squads.sh`.

## 언어(ko | en)
- 해석 순서: 환경변수 `MARU_LANG`(정확히 `ko` 또는 `en`) > `$MARU_DATA/profile.json` 의 `lang`(앱이 사용자의 선택을 여기에 씁니다) > `ko`. 로캘(`LANG`)은 보지 않습니다(launchd 처럼 `LANG` 이 없는 환경에서 기존 한국어 사용자가 바뀌지 않게). CLI 만 쓰는 사용자가 영어를 고르려면 `data/maru.conf` 에 `MARU_LANG=${MARU_LANG:-en}` 한 줄을 둡니다. `lib.sh` 의 `MARU_LANG` 으로 노출됩니다.
- en 이면 회고·정리 프롬프트(`prompts/*.en.md`), 세션 시작 컨텍스트(영어 한 줄 포함), 영어 내장 스쿼드(`squads-en/`)와 코드가 붙이는 고정 머리말, `install.sh`·`uninstall.sh` 의 화면 출력(`== ` 구역 제목 형식과 `(dry-run)` 표지는 그대로)과 전역 CLAUDE.md 블록이 영어입니다. 기계가 읽는 표지(일지 종류 `done|decision|todo`, 날짜 파일의 `[한 일]`/`[결정]`/`[남은 일]`, 요약의 `No changes`/`변경 없음`, `Promoted:`/`승격:`, 각종 `|` 형식)는 언어와 무관하게 그대로입니다. 개인 스쿼드(`data/squads`)는 번역하지 않습니다.
- 새 사용자는 `/first-meeting` 스킬로 짧은 인터뷰를 거쳐 첫 기억을 만들 수 있습니다(저장 전에 계획을 보여 주고 승인을 받습니다).
- `MARU_HOME` 은 git 저장소가 아니어도 됩니다(예: 복사한 `~/.maru`). 개인 이력 저장소는 `data/history.git` 로 따로 있습니다.

## 코드 작업 방식
기준은 CLAUDE.md 「코드 작업」(숫자는 기본값이고 사용자 선호가 우선, 작업 저장소가 자체 워크플로우를 가지면 그쪽이 우선)입니다.
- 크기: 작음(파일 1~2개·약 50줄 이하)은 마루가 직접, 중간(파일 3~8개·흐름 하나)은 기본 팀 `worker`, 큼(흐름 여러 개·9개 이상·병렬 가능·공개 계약 변경·하루 초과)은 개발 스쿼드 `dev`. 인증·결제·삭제·공개 계약·CI 설정에 닿으면 크기와 무관하게 독립 리뷰(새 리뷰어, 구현자의 결론은 안 줌).
- git 저장소의 수정은 새 워크트리 + 새 브랜치(`git worktree add --no-track -b ...`, 저장소 밖 형제 폴더)에서 하고, 끝나면 그 브랜치에 커밋까지만 합니다. 병합·push·PR·워크트리 삭제는 사용자에게 묻습니다.
- `dev` 총괄은 워크트리의 `.maru/tasks/<이름>.md`(커밋 안 함, 워크트리의 `.git/info/exclude` 로 제외)에 작업 문서(목적·범위·공개 계약·완료 조건·결정·구현 기록)를 쓰고, 완료는 문서의 확인 명령을 직접 실행한 결과로만 판정합니다.
- 마루 저장소 밖의 프로젝트는 일을 시작하기 전에 그 프로젝트의 지침(CLAUDE.md·AGENTS.md·`.claude/`·README·CI 설정)을 직접 읽고 요점을 팀원에게 전달합니다. 프로젝트 지침이 마루 기본값보다 우선하되 안전 규칙·사용자 지시가 더 위이며, 프로젝트 자체 팀이 있으면 그것을 씁니다. 오래 걸리는 일은 그 프로젝트 폴더에서 세션을 여는 편이 낫습니다.
- 테스트·빌드 명령은 저장소(README·CI 설정 등)에서 찾으며, 못 찾으면 추측하지 않고 묻습니다.

## 앱의 달력과 프로젝트 목록
- **세션 상태**: 작업 중·입력 대기 같은 상태는 Claude Code 훅(`scripts/agent-state.sh`)이 알려 줍니다. 마루 폴더 안의 세션은 저장소의 프로젝트 설정으로, 앱이 다른 폴더에서 여는 세션은 실행기(`scripts/maru-claude.sh`)가 그 세션에만 `--settings` 로 같은 훅을 붙여서 받습니다(전역 설정은 바꾸지 않음). 훅이 없는 세션은 「상태 알 수 없음」으로 보입니다.
- **패널 너비**: 왼쪽·오른쪽 패널과 가운데 화면 사이 경계를 끌면 너비가 바뀌고(키보드는 경계에 포커스한 뒤 ←/→, Shift 는 크게), 경계를 더블클릭하면 기본 너비로 돌아갑니다. 정한 너비는 앱을 다시 켜도 유지됩니다.
- **달력**: 왼쪽 패널의 달력에서 날짜를 누르면 그날 화면이 열립니다. 그날의 기록(한 일·결정·남은 일)이 프로젝트별로 묶여 나오고 묶음마다 접을 수 있으며, 하루 회고가 있으면 함께 보입니다.
- **캘린더 일정**: 설정에서 캘린더 접근을 켜면 그날의 일정이 같이 나오고, 일정을 누르면 시간·캘린더·장소·메모가 펼쳐집니다. 일정은 메모리에만 두고 디스크에 저장하지 않습니다. 설치된 앱은 EventKit 도우미(`app/native/maru-cal.swift`, `npm run build:native` 로 빌드)로 읽고, 소스에서 실행할 때는 `MARU_APP_CAL_HELPER=1` 을 주지 않으면 더 느린 AppleScript 방식으로 읽습니다.
- **프로젝트 목록**: 진행 중인 프로젝트는 카테고리(태그)별로 묶입니다. 프로젝트 줄은 같은 카테고리 안에서, 카테고리 이름표는 카테고리끼리 끌어서(또는 ⌥↑/⌥↓) 순서를 바꿉니다. 프로젝트를 다른 카테고리로 옮길 수는 없습니다.
- **분류 안 된 작업 · 완료**: 프로젝트 슬러그가 없는 옛 기록은 「분류 안 된 작업」 한 묶음으로 접혀 있습니다. 「완료」를 펼치면 끝낸 프로젝트가 카테고리 묶음 없이 한 줄씩, 카테고리와 끝낸 날이 붙어 나옵니다.

## maru 명령과 cmux Dock
- `bin/maru` 런처: `maru`(저장소에서 claude 실행), `maru app`(데스크톱 앱 열기), `maru ui`, `maru suggest [번호]`, `maru todo [번호]`, `maru status`, `maru log [reflect|dream]`, `maru hist ...`, `maru doctor`(읽기 전용 점검), `maru help`. 스쿼드(`maru squad …`), 프로젝트(`maru project …`), 하위 세션(`maru open …`) 명령은 각 절에서 설명합니다. 런처 자체는 아무것도 설치·수정하지 않습니다. PATH 등록은 `./install.sh --with-cli` 로 합니다(심볼릭 링크를 따라 저장소 위치를 계산).
- `maru ui`(`scripts/maru_ui.py`, 파이썬 표준 라이브러리 curses, 네트워크·포트 없음): 40~60열 좁은 폭용 상황판. 탭 1 상태(30초 자동 갱신, `r`) / 2 기억(Enter 본문, `/` 필터) / 3 로그(`l` reflect·dream 전환) / 4 제안 / 5 추천. `--once`는 상태를 평문으로 출력하고 `--selftest`는 임시 디렉터리에서 로직을 검증합니다.
- 제안 설치는 제안 탭에서 보기를 열고 설치될 `SKILL.md`(PROPOSAL.md 보다 먼저 표시)를 끝까지 스크롤한 뒤 `i`, 정확히 `yes` 를 입력해야만 진행됩니다. 보기를 열 때 `SKILL.md` 를 한 번 읽어 스냅샷으로 고정하고 표시·설치는 그 바이트만 쓰며, 설치 직전 디스크의 sha256 이 다르면 거부합니다. 읽기는 `O_NOFOLLOW`+일반 파일·링크 수 1·100KB 이하만 허용합니다. 이름 정규식(전체 일치)·frontmatter `name` 이 디렉터리 이름과 같을 것·`name`/`description`/`argument-hint`(한 줄·100자 이하·제어 문자 없음일 때만) 외 frontmatter 키 거부(파싱 불가도 거부)·저장소 `.claude/skills` 이름 충돌 거부·기존 스킬 덮어쓰기 거부·숨김/제어 문자·잘못된 UTF-8 거부를 거치며 `SKILL.md` 만 복사합니다. `maru hist` 는 `--output`·`--ext-diff`·`--textconv`·`-c`·`-C`·`--git-dir`·`--work-tree`·`--exec-path` 인자를 거부합니다. `x` 는 삭제 없이 `data/skill-proposals/.rejected/` 로 옮깁니다. 제안 내용은 신뢰할 수 없는 데이터로 표시만 합니다.
- 오늘 할 일: 모델이 stage 폴더에 `todos.txt`(`태그|중요도|제목|프롬프트`, 최대 7줄)를 쓰면 `apply_todos` 가 검증·정렬해 `data/todos.txt` 로 교체하고 프롬프트로 `data/suggestions.txt` 를 다시 만듭니다. `maru todo [번호]` 로 보고 복사합니다(전송 안 함).
- 프로젝트 추적: 일지·todos 의 태그 칸이 `태그/슬러그` 로 프로젝트를 가리킬 수 있습니다(슬러그 `[0-9a-z가-힣-]{1,24}`, 틀리거나 미등록이면 슬러그만 떼고 줄은 유지). 새 프로젝트는 stage 의 `projects.txt`(`태그|슬러그|제목`)로 등록하고 `apply_projects` 가 검증해 `data/projects.txt` 에 병합합니다(제목 40자·첫 제목 유지·200줄 상한). 앱(왼쪽 "프로젝트" 패널)은 일지·레지스트리·`data/project-state.json`(앱이 쓰는 완료·이름·합침 상태)·todos·기억 태그를 읽어 카테고리별 목록과 상세(남은 일·작업 기록·관련 기억·이어서 하기)를 보여 줍니다. 파티 패널은 오른쪽 상태 링 아래로 옮겼습니다.
- 추천 요청(옛 방식도 유지): stage 폴더의 `suggestions.txt` 를 쓰면 셸(`lib.sh` 의 `apply_suggestions`)이 검증해 `data/suggestions.txt` 로 원자적 교체합니다(일반 파일만·64KB 이하·최대 8줄·줄당 120자 이하·제어/bidi/zero-width 문자 줄 제거·중복 제거, 실패하면 기존 목록 유지, 기억 트랜잭션과 독립이며 실패해도 로그만 남김). 보는 곳은 Dock 의 5 추천 탭(↑↓, Enter/`c` 로 클립보드 복사)과 `maru suggest`(목록), `maru suggest <번호>`(복사)입니다. **복사만 하고 절대 전송하지 않습니다**: 붙여넣고 내용을 확인한 뒤 직접 Enter 를 누르세요. cmux 의 다른 서피스로 직접 넣는 기능은 지원하지 않습니다(`cmux send` 가 텍스트의 `\n` 을 Enter 로 해석하고 대상이 기본적으로 호출한 서피스라서).
- Claude Code 내장 프롬프트 추천(답변 뒤 회색 글씨, Tab/→ 로 채움, `promptSuggestionEnabled`)은 Claude Code 기능이라 내용을 조정할 수 없습니다. maru 의 추천은 위의 Dock 탭/`maru suggest` 와, 반복 요청을 `/스킬이름` 으로 부르게 하는 스킬 제안(필요하면 `argument-hint`)으로 제공됩니다.
- cmux Dock: `./install.sh --with-cmux` 가 `~/.config/cmux/dock.json` 을 설치하면 우측 Dock 에서 `maru ui` 가 실행됩니다(cmux 에서의 실제 표시는 미검증). Dock 의 PATH 에 `maru` 가 없어도 되도록 설치 시점의 저장소 `bin/maru` 절대 경로를 직접 부릅니다. `cmux/dock.json` 은 `$HOME/maru` 가정의 예시 원본이며 설치는 `maru_config.py dock-gen` 이 만든 내용을 씁니다.
- 미검증: 실제 cmux Dock 안에서의 동작, 제안 설치·거절의 화면 조작(로직은 `--selftest` 로만 검증), `maru hist`(Xcode 라이선스 미동의 환경에서는 git 이 실패할 수 있음).

## 구조
```
CLAUDE.md          에이전트 정체성과 규칙 (개인 정보 없음)
squads/            내장 스쿼드(dev research)
squads-en/         영어 변형 내장 스쿼드(언어가 en 일 때 같은 slug 의 squads/ 를 대체)
prompts/*.en.md    영어 프롬프트(언어가 en 일 때 사용), CLAUDE.en.md 는 영어 지침
scripts/           squads.py maru-claude.sh test-squads.sh reflect.sh dream.sh telegram.sh mac-inventory.sh lib.sh(설정·도구 해석) launchd.sh test-env.sh digest.py hist maru_config.py maru-status.sh maru_ui.py
bin/maru           런처(ui status log hist doctor)
cmux/              dock.json 등 cmux 연동
prompts/           회고·정리 프롬프트 템플릿 ({{MEMORY_DIR}} 등 자리표시자)
launchd/           plist 템플릿 (설치 때 경로 치환)
.claude/skills/    recall 스킬, mac-control 스킬(SKILL.md + reference/ cli·applescript·apps)
data/              개인 데이터 (gitignore): state logs digests skill-proposals squads squad-proposals squads-trash stage history.git backups maru.conf
```
- 코드는 `MARU_HOME`(스크립트 위치 기준), 개인 데이터는 `MARU_DATA`(기본 `$MARU_HOME/data`)에 둡니다. 설정은 `scripts/lib.sh` 상단 한 곳이며 환경변수 또는 `data/maru.conf`로 덮어씁니다.
- **기억 위치**: Claude Code의 자동 기억 폴더 `~/.claude/projects/<슬러그>/memory/`. 슬러그는 `MARU_HOME`의 실제 경로에서 영숫자가 아닌 문자를 `-`로 바꾼 값입니다(예: `/path/to/maru` → `-path-to-maru`). 그래서 `~/maru`에서 `claude`를 실행하면 색인이 자동으로 로드됩니다.
- **하루 회고(daily note)**: 새벽 정리(`dream.sh`)가 최근 7일 중 일지가 있는 날(오늘 제외, 아직 회고가 없는 날)에 대해 한 번에 최대 2개, 최신 날짜부터 짧은 일기 글을 `<기억 폴더>/diary/YYYY-MM-DD.md` 에 둡니다. 날짜는 셸이 고르고, 글은 모델이 그날 일지 줄에 적힌 내용만으로 쓰며(지어낸 내용 금지), 셸(`apply_diary`)이 길이·비밀값·무해화를 검증해 `# 제목`, 빈 줄, 본문 형식으로 설치합니다. 이미 있는 파일은 덮어쓰지 않고, 기억 변경 이력(`maru hist`)에 함께 남습니다. 세션 시작 컨텍스트와 기억 색인에는 들어가지 않습니다. 파일을 지워도 안전합니다. 그날이 최근 7일 안이면 새벽 정리가 실제로 도는 다음 때 다시 만들어지고(정리는 기억이나 일지가 바뀐 밤에만 돕니다), 7일이 지났으면 다시 만들어지지 않습니다.
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
[MIT](../LICENSE)

## 공개 전 할 일
- 커밋 작성자 정체성: 지금은 임시 값입니다. 공개용 이름·이메일을 정하고 이력을 다시 쓰세요.
- `git grep -n -i`로 개인 정보(이름·경로·회사명)가 없는지 마지막으로 확인.
