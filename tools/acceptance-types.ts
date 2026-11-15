// 브라우저(검수표 화면)와 저장 API가 함께 쓰는 검수표 데이터.
export type Decision = { decision: '승인' | '반려' | '보류'; note: string; revision: number; updatedAt: string };
export type ReviewItem = { task_id: string; name: string; goal: string; now: boolean; conditions: { id: string; text: string }[] };
