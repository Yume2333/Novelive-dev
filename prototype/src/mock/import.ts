// 新建工程向导的 mock 数据（只服务 ImportPage）

export interface SourceFile {
  name: string
  /** 封面/正文文件格式 */
  kind: 'txt' | 'epub' | 'md' | 'docx' | 'pdf' | 'image'
  size: string
  state: '已解析' | '已就绪'
}

export const initialSourceFiles: SourceFile[] = [
  { name: '雾港来信.epub', kind: 'epub', size: '1.8 MB', state: '已解析' },
]

export const fileKindIcon: Record<SourceFile['kind'], string> = {
  txt: 'description',
  epub: 'menu_book',
  md: 'markdown',
  docx: 'article',
  pdf: 'picture_as_pdf',
  image: 'image',
}

/** 模拟添加的正文文件与参考图，点“选择文件”循环出结果 */
export const extraSourceFiles: SourceFile[] = [
  { name: '雾港来信-下.epub', kind: 'epub', size: '1.2 MB', state: '已解析' },
]
export const extraRefImages: SourceFile[] = [
  { name: '参考图-凛-制服.png', kind: 'image', size: '640 KB', state: '已就绪' },
  { name: '参考图-码头-黄昏.png', kind: 'image', size: '580 KB', state: '已就绪' },
]

/** 章节划分核对用的模拟结果 */
export interface DraftChapter {
  id: number
  title: string
  volumeId: number
}

export interface DraftVolume {
  id: number
  title: string
}

export const draftVolumes: DraftVolume[] = [
  { id: 1, title: '第一卷' },
  { id: 2, title: '第二卷' },
]

export const draftChapters: DraftChapter[] = [
  { id: 1, title: '码头的雾', volumeId: 1 },
  { id: 2, title: '未署名的信', volumeId: 1 },
  { id: 3, title: '灯塔看守人', volumeId: 1 },
  { id: 4, title: '退潮之后', volumeId: 1 },
  { id: 5, title: '旧航海图', volumeId: 1 },
  { id: 6, title: '风暴前夜', volumeId: 2 },
  { id: 7, title: '沉没的回声', volumeId: 2 },
  { id: 8, title: '雾散时分', volumeId: 2 },
]

export const detectedInfo = {
  title: '雾港来信',
  author: '林泊',
  sourceLanguage: '简体中文',
  workLanguage: '简体中文',
}
