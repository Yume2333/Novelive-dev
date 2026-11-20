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

/** 章节划分核对用的模拟结果：这一份原文没有分卷，所以只有平铺的章节 */
export interface DraftChapter {
  id: number
  title: string
}

/** 整理角色按剧情段落建议的分卷：卷名 + 起止章（按章节数组下标，闭区间） */
export interface DraftVolume {
  id: number
  title: string
  from: number
  to: number
}

export const draftVolumes: DraftVolume[] = [
  { id: 1, title: '雾起', from: 0, to: 4 },
  { id: 2, title: '回航', from: 5, to: 7 },
]

export const draftChapters: DraftChapter[] = [
  { id: 1, title: '码头的雾' },
  { id: 2, title: '未署名的信' },
  { id: 3, title: '灯塔看守人' },
  { id: 4, title: '退潮之后' },
  { id: 5, title: '旧航海图' },
  { id: 6, title: '风暴前夜' },
  { id: 7, title: '沉没的回声' },
  { id: 8, title: '雾散时分' },
]

export const detectedInfo = {
  title: '雾港来信',
  author: '林泊',
  sourceLanguage: '简体中文',
  workLanguage: '简体中文',
}
