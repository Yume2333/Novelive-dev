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

// 纯 CSS 的书籍封面：渐变底 + 书脊 + 纸面高光 + motif 图标，避免位图素材
export function GradientCover({ work, style }: { work: Work; style?: CSSProperties }) {
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
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 14, background: 'linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0.05) 70%, transparent)' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 14, width: 1.5, background: 'rgba(255,255,255,0.28)' }} />
      {/* 纸面光泽 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 30% 15%, rgba(255,255,255,0.28), transparent 55%), linear-gradient(200deg, rgba(255,255,255,0.1), transparent 40%), radial-gradient(ellipse at 80% 95%, rgba(0,0,0,0.18), transparent 55%)',
        }}
      />
      {/* 封面排版：细框 + 图标 + 竖排感标题 */}
      <div
        style={{
          position: 'relative',
          margin: '12% 14% 12% calc(14% + 8px)',
          flex: 1,
          alignSelf: 'stretch',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 3,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 12,
        }}
      >
        <Icon name={motifIcon[work.coverMotif]} size={34} style={{ color: 'rgba(255,255,255,0.8)' }} />
        <div
          style={{
            color: 'rgba(255,255,255,0.92)',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '0.3em',
            marginRight: '-0.3em',
            textAlign: 'center',
            lineHeight: 1.6,
            textShadow: '0 1px 4px rgba(0,0,0,0.25)',
          }}
        >
          {work.title}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, letterSpacing: '0.25em' }}>{work.author}</div>
      </div>
    </div>
  )
}
