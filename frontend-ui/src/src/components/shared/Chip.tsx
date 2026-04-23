import type { ReactNode, CSSProperties } from 'react';
import styles from './Chip.module.css';

interface ChipProps {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}

export function Chip({ children, color, style }: ChipProps) {
  const inlineStyle: CSSProperties = color
    ? { color, background: `${color}22`, ...style }
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
