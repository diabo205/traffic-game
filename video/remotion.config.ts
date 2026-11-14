import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('jpeg');
Config.setConcurrency(2);
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? null);
