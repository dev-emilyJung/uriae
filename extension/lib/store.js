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
  selected: 'selectedClasses', // 선택한 반(소속 id) 목록. 없으면 전체 선택
  checked: 'checked', // 챙김 체크 상태 {itemKey: true}
  refs: (child) => `refs:${child}`, // 아이별 기준 얼굴 임베딩 [{id, emb:number[], thumb}]
  scores: (child) => `scores:${child}`, // 아이별 사진 유사도 캐시 {imageId: score}
  threshold: 'threshold', // {sure, maybe}
};
