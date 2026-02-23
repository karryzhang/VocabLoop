# VocabLoop

基于**间隔重复（SRS）算法**的英语词汇 PWA，支持离线使用与真人发音。

## 功能

- 🃏 卡片翻转式 SRS 学习（SM-2 改良算法）
- ✏️ 练习模式：选择题、判断题、拼写题
- 🔊 真人发音（词典 API + 缓存）
- 📊 实时进度：新词 / 学习中 / 复习中 / 已掌握
- 📋 列表模式：查看当天学习单词
- 🏆 成就系统 + 连续学习天数
- 📱 PWA：可安装到 iOS / Android 主屏幕，完全离线可用

## 词库

| 词库 | 单词数 | 说明 |
|------|--------|------|
| 📚 PET 词汇 | 1000 | 剑桥 PET 考试核心词汇 |
| 💬 日常口语 | 1000 | 日常英语口语短语与表达 |
| ₿ 加密金融 | 1000 | 加密货币与金融英语术语 |

## 使用

直接用浏览器打开 `index.html`，或部署到任意静态托管服务（GitHub Pages 等）。

## 文件结构

```
VocabLoop/
  index.html          # 单文件 PWA 主程序
  manifest.json       # PWA 清单
  icons/              # 应用图标
  data/
    pet-words-1000.json
    daily-words-1000.json
    crypto-words-1000.json
```

## License

MIT
