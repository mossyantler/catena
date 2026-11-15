#!/bin/sh
# Engine MVP 검수 시험(T25) 준비: 예시 저장소를 만들고, 계획(A: Claude Code → B: Codex)을 불러와 Project를 설정한다.
# 사용: sh examples/engine-mvp/setup.sh [작업 폴더]   (기본 ~/.catena/examples/engine-mvp)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
DIR=${1:-$HOME/.catena/examples/engine-mvp}
if [ -e "$DIR" ]; then echo "이미 있다: $DIR (처음부터 다시 하려면 이 폴더를 지운다)" >&2; exit 1; fi
mkdir -p "$DIR"
cp -R "$HERE/sample" "$DIR/repo"
git -C "$DIR/repo" init -q -b main
git -C "$DIR/repo" add .
git -C "$DIR/repo" -c user.name=Catena -c user.email=catena@localhost commit -qm '예시 저장소 기준'
CLI="node $ROOT/tools/catena.ts"
$CLI plan import "$HERE/plan.json" --store "$DIR/store"
$CLI project configure --store "$DIR/store" --repo "$DIR/repo" --permission-mode acceptEdits
BASE=$(git -C "$DIR/repo" rev-parse HEAD)
echo "
준비했다. 차례대로 실행한다.
  1) A (Claude Code):  $CLI run A --store $DIR/store --base-ref $BASE
  2) B (Codex):        $CLI run B --store $DIR/store
     B가 사용자 승인을 기다리면 다른 터미널에서 안내된 approve 명령을 실행한다.
  상태 보기: $CLI status --store $DIR/store   ·   $CLI graph --store $DIR/store"
