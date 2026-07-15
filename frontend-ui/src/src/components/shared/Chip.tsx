import type { ReactNode, CSSProperties } from 'react';
import styles from './Chip.module.css';
import { tint } from '../../lib/colors';

interface ChipProps {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}

export function Chip({ children, color, style }: ChipProps) {
  const inlineStyle: CSSProperties = color
    ? { color, background: tint(color, 13), ...style }
    : style ?? {};

  return (
    <span
      className={styles.chip}
      style={inlineStyle}
    >
      {children}
    </span>
  );
}
