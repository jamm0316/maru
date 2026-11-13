# 시스템 설정 (com.apple.systempreferences)
- 스크립트: 사전은 있다(`SystemPreferences.sdef`, 확인됨) 하지만 창 조작은 UI 스크립팅(손쉬운 사용)이 필요해 불안정하다.
## 빠른 방법
- 값 읽기는 `defaults read`(예: `defaults read -g AppleInterfaceStyle`, `com.apple.dock tilesize`)가 앱 없이 된다.
- 창 열기: `open "x-apple.systempreferences:com.apple.preference.security"`(미검증). 개인정보 권한 안내 때 해당 창을 열어 주는 용도로만.
## 함정
- 보안·개인정보 설정은 에이전트가 바꾸지 않는다. 열어서 사용자가 직접 토글하게 한다.
- 설정 키 이름은 macOS 버전마다 바뀐다. 쓰기 전 `read`로 키가 실제로 있는지 본다.
## 검증: 2026-11 macOS 26 — 읽기 명령만 확인
