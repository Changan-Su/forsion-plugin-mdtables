#!/usr/bin/env bash
# 装/更新「表格工作台」插件到 Forsion 家目录。
#   用法:sh install.sh [dev|prod]     缺省 dev(~/.forsion-dev);prod=~/.forsion
# 本仓即插件本体:整目录拷到 <home>/plugins/md-tables/ 一处即完成——
#   桌面识别 manifest.json(UI 插件)+ spaces/(内嵌 Space)。
# 本插件不含 agent / 技能 / 引擎插件,也不产出任何用户文件,重装无迁移问题。
set -euo pipefail
MODE="${1:-dev}"
case "$MODE" in
  dev)  HOME_DIR="$HOME/.forsion-dev" ;;
  prod) HOME_DIR="$HOME/.forsion" ;;
  *) echo "用法:sh install.sh [dev|prod]" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME_DIR/plugins/md-tables"

# 不许从已安装目录内自更新:下面的 rm -rf 会先删掉复制源(自己),把插件卸成空壳
if [ "$HERE" = "$(cd "$DEST" 2>/dev/null && pwd || true)" ]; then
  echo "❌ 正在从已安装目录运行,请从源码仓的 forsion-plugin-mdtables/ 目录执行 install.sh" >&2
  exit 2
fi

mkdir -p "$HOME_DIR/plugins"
rm -rf "$DEST"
cp -R "$HERE" "$DEST"

echo "✅ 已安装 → $DEST"
echo "重开 Forsion(dev:重启 desktop)后:把光标放进任意一张 markdown 表格,工具条会浮出来;"
echo "或命令面板「表格工作台」,或工作台切到「表格工作台」Space。"
