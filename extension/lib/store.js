// chrome.storage.local 래퍼. 모든 데이터는 이 컴퓨터의 브라우저 안에만 저장된다.
export const store = {
  async get(key, fallback) {
    const r = await chrome.storage.local.get(key);
    return r[key] ?? fallback;
  },
  set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  },
  remove(key) {
    return chrome.storage.local.remove(key);
  },
};

// 키 이름 모음
export const K = {
  kid: 'currentKid', // 지금 보고 있는 아이
  selected: 'selectedClasses', // 선택한 반(소속 id) 목록. 없으면 전체 선택
  checked: 'checked', // 챙김 체크 상태 {itemKey: true}
  hidden: 'hiddenCards', // "해당 없음"으로 지운 안내 카드 {cardKey: 안내 날짜} (60일 지나면 정리)
  faceLog: 'dev:faceLog', // 개발용 설치에서만: 사진 찾기별 Y/N 답 수 [{at, label, sure, maybe, sureYes, sureNo, maybeYes, maybeNo}]
  prepView: 'prepView', // 챙길 것 보기 방식 'list' | 'cal'
  refs: (child) => `refs:${child}`, // 아이별 기준 얼굴 임베딩 [{id, emb:number[], thumb}]
  scores: (child) => `scores2:${child}`, // 아이별 사진 얼굴 점수 {sig: 기준얼굴 id 목록, map: {imageId: [얼굴별 점수]}}
  strictness: 'strictness', // 0(많이 찾기) ~ 1(정확하게)
  ocr: 'ocr1', // 그림 안내문에서 읽은 글자 {그림 key: {at, doc, text}} (60일 보관)
};
