// 브라우저와 저장 API가 공유하는 첨삭 데이터.
export type CopyItem = { id: string; category: string; original: string; suggested: string; context: string };
export type CopyDecision = 'draft' | 'approved' | 'keep' | 'deferred';
export type CopyReview = { text: string; note: string; decision: CopyDecision; revision: number; updatedAt: string };
export type CopyData = { items: CopyItem[]; reviews: Record<string, CopyReview> };
