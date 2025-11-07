export type TtsQuery = {
  text: string;
  voice_id?: string;
  speed?: number;
  model?: string;
  output_format?: string;
};
