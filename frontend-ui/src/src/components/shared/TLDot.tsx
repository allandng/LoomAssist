import type { CSSProperties } from 'react';
import styles from './TLDot.module.css';

interface TLDotProps {
  color: string;
  size?: number;
  style?: CSSProperties;
}

export function TLDot({ color, size = 8, style }: TLDotProps) {
  return (
    <span
      className={styles.dot}
      style={{ width: size, height: size, background: color, ...style }}
    />
  );
}
