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

  return (
    <img
      src="/aethervault-icon.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${dims} block shrink-0 select-none object-cover`}
    />
  );
};
