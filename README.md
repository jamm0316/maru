# 마루 (maru)

Claude Code 위에서 도는 **개인 총괄 에이전트**입니다. 이 폴더에서 `claude`를 실행하면 마루가 되고, 쓸수록 사용자에 맞춰지도록 대화를 회고해 장기 기억을 쌓습니다.

- **회고(학습 루프)**: 세션이 끝날 때(SessionEnd 훅) 제한된 권한의 헤드리스 `claude -p`가 대화 요약을 읽고 기억 파일을 갱신합니다.
- **정기 정리(dream)**: 매일 03:30 launchd 작업이 놓친 세션을 회고하고 기억을 정리합니다.
- **스킬 제안**: 반복되는 절차는 `data/skill-proposals/`에 제안으로만 쌓입니다. 기본값에서는 에이전트가 제안 내용을 한 줄로 알리고 사용자가 명시적으로 승인한 뒤에만 설치합니다(아래 `MARU_SKILL_AUTOINSTALL` 참고).
- **recall 스킬**: 과거 대화를 검색합니다.

## 요구사항
macOS(launchd, BSD `stat`/`md5` 사용), `claude`(Claude Code, 구독 로그인), `jq`, `python3`, `git`, `perl`.

## 설치 / 제거
```
./install.sh --dry-run   # 할 일만 출력
./install.sh             # 멱등: 여러 번 실행해도 안전
./uninstall.sh           # 설치한 것만 되돌림 (data/ 와 기억은 남김). --dry-run 지원
```
설치가 하는 일(경로에 공백이 있어도 동작): `data/`와 기억 폴더 생성 / `~/.claude/settings.json`의 SessionEnd에 훅 1개 등록(수정 전 `data/backups/`에 타임스탬프 백업. 파일 전체를 JSON으로 읽어 다시 쓰므로 **파일이 재작성된다**: 키 순서·알 수 없는 필드·다른 훅의 위치는 보존하고 들여쓰기 형식을 유지하며 임시 파일 + rename으로 원자적으로 쓰지만, 주석처럼 JSON 밖의 서식은 보존되지 않는다) / launchd 작업 `com.maru.dream` 등록 / `recall` 스킬을 `~/.claude/skills/recall`에 복사(`.maru` 표식 파일을 넣고, 표식 없는 기존 `recall`은 건드리지 않음) / `.claude/settings.local.json`에 홈 디렉터리 접근 허용 / `~/.claude/CLAUDE.md`에 `<!-- maru:begin -->`…`<!-- maru:end -->` 블록 유지.

제거(`uninstall.sh`)는 설치가 한 일만 되돌립니다: 훅 항목, launchd 작업, `~/.claude/CLAUDE.md`의 maru 블록(블록 밖은 건드리지 않음), `.maru` 표식이 있는 전역 recall, `.claude/settings.local.json`의 홈 접근 항목, `~/.maru-work`. **`data/`(개인 데이터·변경 이력·백업)와 기억 폴더는 남깁니다.**

### 홈 디렉터리 전체 접근은 의도된 선택
`.claude/settings.local.json`의 `permissions.additionalDirectories`에 홈을 넣는 것은 총괄 에이전트가 이 맥 전체에서 일하도록 한 의도적 선택입니다. 즉 `~/maru`에서 실행한 `claude`는 홈 아래 어디든 읽고(쓰기·실행은 일반 권한 규칙에 따름) 작업할 수 있으니, 신뢰할 수 있는 지시만 주세요. 좁히려면 그 파일의 `additionalDirectories`를 필요한 폴더 목록으로 바꾸거나 항목을 지우면 됩니다(`install.sh` 재실행은 홈을 다시 추가하므로 설치 후 직접 편집하세요). 이 설정은 헤드리스 회고에는 적용되지 않습니다(작업 폴더가 저장소 밖이므로).

### 설정
`scripts/lib.sh` 상단 블록의 값은 환경변수나 `data/maru.conf`(`VAR=${VAR:-값}` 형식)로 덮어씁니다. `CLAUDE_CONFIG_DIR`도 따릅니다(launchd plist에는 설치 때의 값이 기록됩니다).
- `MARU_SKILL_AUTOINSTALL=1`(선택, 기본 꺼짐): install.sh가 `~/.claude/CLAUDE.md` 블록에 "에이전트가 검토 후 문제없으면 직접 설치하고 알린다"는 문구를 씁니다. **위험**: 세션에 주입된 텍스트(웹페이지·붙여넣은 문서)가 스킬 제안으로 흘러들어 사용자 승인 없이 설치되면, 그 스킬은 모든 프로젝트에서 로드됩니다. 켜기 전에 이 위험을 이해하고 설치 후 `install.sh`를 다시 실행하세요.

## 구조
```
CLAUDE.md          에이전트 정체성과 규칙 (개인 정보 없음)
scripts/           reflect.sh dream.sh lib.sh(설정 블록) digest.py hist maru_config.py
prompts/           회고·정리 프롬프트 템플릿 ({{MEMORY_DIR}} 등 자리표시자)
launchd/           plist 템플릿 (설치 때 경로 치환)
.claude/skills/    recall 스킬
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
