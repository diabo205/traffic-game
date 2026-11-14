import React from 'react';
import { Composition } from 'remotion';
import '@fontsource/anton/400.css';
import '@fontsource/inter/300.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import { DevJourney } from './DevJourney';
import { DURATION, FPS } from './timing';

export const Root: React.FC = () => (
  <Composition id="DevJourney" component={DevJourney} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
);
