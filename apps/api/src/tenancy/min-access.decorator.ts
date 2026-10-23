import { SetMetadata } from '@nestjs/common';
import type { AccessLevel } from '@shiftswap/shared';

export const MIN_ACCESS_KEY = 'minAccess';
export const MinAccess = (level: AccessLevel) => SetMetadata(MIN_ACCESS_KEY, level);
