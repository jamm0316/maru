# Reminders (com.apple.reminders)

## 미리 알림 만들기 (검증됨)
- `tell application "Reminders" to make new reminder at end of list "<목록>" with properties {name:…, body:…, due date:d}`
- 날짜는 `current date` 를 복사해 year/month/day/hours/minutes/seconds 를 하나씩 설정한다.
- 마감 시각이 있는 미리 알림은 Calendar 의 「예정된 미리 알림」 캘린더에도 보인다(읽기 전용 표시).
- 검증: `every reminder whose name contains "…"` 로 다시 읽고 `due date`·`completed` 확인.

## 함정
- `remind me date` 를 함께 넣으면 `due date` 도 같은 값으로 덮인다. 마감 시각과 알림 시각을 따로 둘 수 없으니 둘 중 하나만 정한다.
