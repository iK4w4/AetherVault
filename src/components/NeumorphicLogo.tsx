import React from 'react';

interface NeumorphicLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export const NeumorphicLogo: React.FC<NeumorphicLogoProps> = ({ size = 'md' }) => {
  const dims =
    size === 'lg'
      ? 'w-16 h-16 rounded-[20px]'
      : size === 'sm'
      ? 'w-9 h-9 rounded-[12px]'
      : 'w-12 h-12 rounded-[16px]';

  const iconDims =
    size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <div
      className={`${dims} neu-raised-sm flex items-center justify-center shrink-0 select-none`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        className={iconDims}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M16 3.5L6.5 7.5V14.8C6.5 21.3 10.55 27.15 16 28.8C21.45 27.15 25.5 21.3 25.5 14.8V7.5L16 3.5Z"
          stroke="var(--neu-accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx="16"
          cy="14.5"
          r="2.6"
          stroke="var(--neu-accent)"
          strokeWidth="2"
        />
        <path
          d="M16 17.1V21.2"
          stroke="var(--neu-accent)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};
