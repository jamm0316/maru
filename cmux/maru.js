// maru 패널(Custom Sidebar, .js). cmux 0.64.13 이상 필요(설치된 0.64.10 에는 없음).
// 인터프리터 사이드바는 파일·네트워크·프로세스를 쓸 수 없어 maru-status.sh 를 직접 못 부른다.
// 그래서 push-status.sh 가 "maru" 라는 제목의 워크스페이스 description 에 상태를 써 두고, 이 패널은 그것을 읽어 보여 준다.
//   설치: cp cmux/maru.js ~/.config/cmux/sidebars/maru.js   →  cmux sidebar validate maru
//   켜기: cmux right-sidebar set custom maru   (또는 사이드바 버튼 우클릭 메뉴에서 maru)
const ws = () => (data.workspaces() ?? []).find((w) => w.title === "maru") ?? null;

sidebar(() =>
  VStack({ spacing: 8 }, [
    Text("maru").font(15).weight("semibold"),
    Divider(),
    Text(() => ws()?.description ?? "상태 없음 — cmux/push-status.sh 를 실행하세요")
      .font(12).monospaced().color("secondary"),
    Text(() => "갱신 " + (data.clock()?.time ?? "")).font(10).color("tertiary"),
  ]).padding(10)
);
