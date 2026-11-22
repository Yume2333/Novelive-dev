import type { CSSProperties } from 'react'
import type { Work } from '../mock/types'
import { Icon } from './Button'

const motifIcon: Record<Work['coverMotif'], string> = {
  lighthouse: 'brightness_alert',
  letter: 'mail',
  wave: 'waves',
  star: 'auto_awesome',
  sun: 'wb_sunny',
  moon: 'dark_mode',
}

/* 封面画面层：书脊压暗/装订线、纸面高光、细框、标题文字全是「印在封面上」的绘制内容，
   不是界面色，不随亮暗主题变。封面主色本身在数据里（work.coverGradient）。 */
const coverInk = {
  spineShade: 'linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0.05) 70%, transparent)',
  spineLine: 'rgba(255,255,255,0.28)',
  gloss:
    'radial-gradient(ellipse at 30% 15%, rgba(255,255,255,0.28), transparent 55%), linear-gradient(200deg, rgba(255,255,255,0.1), transparent 40%), radial-gradient(ellipse at 80% 95%, rgba(0,0,0,0.18), transparent 55%)',
  frame: 'rgba(255,255,255,0.35)',
  motif: 'rgba(255,255,255,0.8)',
  title: 'rgba(255,255,255,0.92)',
  titleShadow: '0 1px 4px rgba(0,0,0,0.25)',
  author: 'rgba(255,255,255,0.55)',
}

// 纯 CSS 的书籍封面：渐变底 + 书脊 + 纸面高光 + motif 图标，避免位图素材
export function GradientCover({ work, compact, style }: { work: Work; compact?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: work.coverGradient,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {/* 书脊：左侧压暗条 + 装订高光线 */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: compact ? 8 : 14, background: coverInk.spineShade }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: compact ? 8 : 14, width: compact ? 1 : 1.5, background: coverInk.spineLine }} />
      {/* 纸面光泽 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: coverInk.gloss,
        }}
      />
      {/* 封面排版：细框 + 图标 + 竖排感标题 */}
      <div
        style={{
          position: 'relative',
          margin: compact ? '10% 10% 10% calc(10% + 5px)' : '12% 14% 12% calc(14% + 8px)',
          flex: 1,
          alignSelf: 'stretch',
          border: `1px solid ${coverInk.frame}`,
          borderRadius: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: compact ? 0 : 12,
          padding: compact ? 6 : 12,
        }}
      >
        <Icon name={motifIcon[work.coverMotif]} size={compact ? 24 : 34} style={{ color: coverInk.motif }} />
        {!compact ? (
          <>
            <div
              style={{
                color: coverInk.title,
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '0.3em',
                marginRight: '-0.3em',
                textAlign: 'center',
                lineHeight: 1.6,
                textShadow: coverInk.titleShadow,
              }}
            >
              {work.title}
            </div>
            <div style={{ color: coverInk.author, fontSize: 10, letterSpacing: '0.25em' }}>{work.author}</div>
          </>
        ) : null}
      </div>
    </div>
  )
}
