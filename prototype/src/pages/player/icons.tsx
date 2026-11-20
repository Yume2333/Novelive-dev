import {
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FastForward,
  FolderOpen,
  LogOut,
  Maximize,
  Menu,
  Minimize,
  PencilLine,
  Play,
  Save,
  ScrollText,
  Settings2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'

/* 播放器图标 — lucide-react，strokeWidth 1.8，统一大小 18 */
export type PlayerIconName =
  | 'quicksave' | 'quickload' | 'save' | 'load' | 'auto' | 'skip' | 'log' | 'chapters' | 'settings' | 'hide'
  | 'menu' | 'rollback' | 'fullscreen' | 'exitFullscreen' | 'edit' | 'exit' | 'close' | 'pageLeft' | 'pageRight' | 'next' | 'play' | 'back'


const map: Record<PlayerIconName, LucideIcon> = {
  quicksave: BookmarkPlus,
  quickload: BookmarkCheck,
  save: Save,
  load: FolderOpen,
  auto: Play,
  skip: FastForward,
  log: ScrollText,
  chapters: BookOpen,
  settings: Settings2,
  hide: EyeOff,
  menu: Menu,
  rollback: Undo2,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  edit: PencilLine,
  exit: LogOut,
  close: X,
  pageLeft: ChevronLeft,
  pageRight: ChevronRight,
  next: ChevronDown,
  play: Play,
  back: Undo2,
}

export function PlayerIcon({ name, size = 18, style }: { name: PlayerIconName; size?: number; style?: CSSProperties }) {
  const C = map[name]
  return <C size={size} strokeWidth={1.8} style={{ display: 'block', flexShrink: 0, ...style }} aria-hidden />
}
