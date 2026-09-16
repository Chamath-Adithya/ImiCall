import React from 'react';

interface AudioWaveformProps {
  volume: number; // 0 to 100
  isActive: boolean;
  color?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  volume,
  isActive,
  color = '#10b981',
}) => {
  const bars = [0.3, 0.6, 1.0, 0.7, 0.4];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        height: '28px',
      }}
    >
      {bars.map((scale, i) => {
        const heightMultiplier = isActive ? Math.max(0.15, (volume / 100) * scale) : 0.15;
        const height = Math.round(heightMultiplier * 24);

        return (
          <div
            key={i}
            style={{
              width: '4px',
              height: `${Math.max(4, height)}px`,
              backgroundColor: isActive && volume > 5 ? color : '#334155',
              borderRadius: '2px',
              transition: 'height 0.08s ease-out, background-color 0.2s ease',
            }}
          />
        );
      })}
    </div>
  );
};
