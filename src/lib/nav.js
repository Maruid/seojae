// 권한에 따라 하단 탭 / 사이드바 메뉴 구성 (순수 함수)
//   칼럼만: 홈 · 칼럼 · 내 정보
//   둘 다:  홈 · 칼럼 · 소설 · 내 정보
//   관리자: 홈 · 칼럼 · 소설 · 내 정보 · 관리
//   권한 0개: 홈 · 내 정보

const SECTOR_TAB = {
  column: (s) => ({ key: 'columns', label: s.name, href: '#/columns', icon: 'columns', match: ['columns', 'column'] }),
  novel:  (s) => ({ key: 'novels',  label: s.name, href: '#/novels',  icon: 'novels',  match: ['novels', 'novel', 'chapter'] }),
};

export function tabsFor(me) {
  const tabs = [{ key: 'home', label: '홈', href: '#/', icon: 'home', match: ['home'] }];
  for (const s of me?.sectors || []) {
    const make = SECTOR_TAB[s.kind];
    if (make && !tabs.some((t) => t.key === make(s).key)) tabs.push(make(s));
  }
  tabs.push({ key: 'me', label: '내 정보', href: '#/me', icon: 'me', match: ['me', 'install', 'downloads'] });
  if (me?.is_admin) tabs.push({ key: 'admin', label: '관리', href: '#/admin', icon: 'admin', match: ['admin'] });
  return tabs;
}

export function activeTab(tabs, routeName) {
  return tabs.find((t) => t.match.includes(routeName))?.key ?? null;
}

export function canAccess(me, kind) {
  return !!me?.sectors?.some((s) => s.kind === kind);
}
