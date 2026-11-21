// i18next：开发期只写简体中文，按页面分命名空间（M5 再翻译）。
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const zhHans = {
  shell: {
    library: "书库",
    usage: "用量",
    settings: "设置",
    themeLight: "亮色",
    themeDark: "暗色",
    themeSystem: "跟随系统",
  },
  library: {
    title: "书库",
    emptyTitle: "书库还是空的",
    emptyDesc: "新建工程开始改编小说，或导入 .novelive 作品包直接游玩",
    newProject: "新建工程",
    importPackage: "导入作品包",
  },
  usage: {
    title: "用量",
    emptyTitle: "还没有用量记录",
    emptyDesc: "接入模型后开始创作，这里会统计每次调用的 token 和花费。",
  },
  settings: {
    title: "设置",
    models: "模型",
    interface: "界面",
    project: "工程",
    about: "关于",
    test: "测试",
    testing: "正在测试…",
    testOk: "连接成功",
    testFail: "连接失败 · 检查接口地址、API Key、模型名",
    configured: "已配置",
    unconfigured: "未配置",
    apiFormat: "接口格式",
    baseUrl: "接口地址",
    modelName: "模型名",
    contextLength: "上下文长度",
    apiKey: "API Key",
    inheritFast: "同快速模型",
    catalogMiss: "目录里没有，可以手填",
    imageModel: "图片模型",
    concurrency: "同时出图数",
    retries: "生图失败重试次数",
    t2i: "文生图",
    transparent: "透明底",
    edit: "图片编辑",
    capOk: "通过",
    capUnsupported: "不支持",
    capFail: "失败",
    capTesting: "进行中",
    unsupportedHint: "这个模型不支持透明底，换一个支持的模型。",
    language: "界面语言",
    theme: "主题",
    defaultDir: "默认工程位置",
    change: "更改",
    configError: "配置文件读不出来",
    sqliteSmoke: "SQLite 冒烟",
    sqliteOk: "通过",
    sqliteFail: "失败",
  },
  banner: {
    creatorDown: "创作端已停止，日志在 {{dir}}",
    restart: "重新启动",
    reconnecting: "创作端重连中…",
  },
};

void i18n.use(initReactI18next).init({
  resources: { "zh-Hans": { translation: zhHans } },
  lng: "zh-Hans",
  fallbackLng: "zh-Hans",
  interpolation: { escapeValue: false },
});

export default i18n;
