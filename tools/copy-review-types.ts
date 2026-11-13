// 브라우저와 저장 API가 공유하는 첨삭 데이터.
// basis: 이미 정한 용어만으로 정해진 항목의 근거. 없으면 사용자 판단이 필요하다
export type CopyItem = { id: string; category: string; original: string; suggested: string; context: string; basis?: string };
export type CopyDecision = 'draft' | 'approved' | 'keep' | 'deferred';
export type CopyReview = { text: string; note: string; decision: CopyDecision; revision: number; updatedAt: string };
export type CopyData = { items: CopyItem[]; reviews: Record<string, CopyReview> };
