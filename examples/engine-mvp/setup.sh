#!/bin/sh
# Engine MVP 검수 시험(T25) 준비: 예시 저장소를 만들고, 계획(A: Claude Code → B: Codex)을 불러와 Project를 설정한다.
# 사용: sh examples/engine-mvp/setup.sh [작업 폴더]
#   작업 폴더를 주지 않으면 예시 저장소는 ~/.catena/examples/engine-mvp/repo, Project 저장소는 기본 위치
#   ~/.catena/projects/engine-mvp-example이다(실시간 화면 ?live=engine-mvp-example에 보인다). 주면 둘 다 그 폴더 안(repo, store)이다.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DIR=${1:-$HOME/.catena/examples/engine-mvp}
STORE=${1:+$1/store}
STORE=${STORE:-$HOME/.catena/projects/engine-mvp-example}
for p in "$DIR" "$STORE"; do
  if [ -e "$p" ]; then echo "이미 있다: $p (처음부터 다시 하려면 이 폴더를 지운다)" >&2; exit 1; fi
done
mkdir -p "$DIR"
cp -R "$HERE/sample" "$DIR/repo"
git -C "$DIR/repo" init -q -b main
git -C "$DIR/repo" add .
git -C "$DIR/repo" -c user.name=Catena -c user.email=catena@localhost commit -qm '예시 저장소 기준'
CLI="node $ROOT/tools/catena.ts"
$CLI plan import "$HERE/plan.json" --store "$STORE"
$CLI project configure --store "$STORE" --repo "$DIR/repo" --permission-mode acceptEdits
BASE=$(git -C "$DIR/repo" rev-parse HEAD)
echo "
준비했다. 차례대로 실행한다.
  1) A (Claude Code):  $CLI run A --store $STORE --base-ref $BASE
  2) B (Codex):        $CLI run B --store $STORE
     B가 사용자 승인을 기다리면 다른 터미널에서 안내된 approve 명령을 실행한다.
  상태 보기: $CLI status --store $STORE   ·   $CLI graph --store $STORE"
