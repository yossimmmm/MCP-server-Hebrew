declare module "@google-cloud/speech" {
  export class SpeechClient {
    constructor(options?: any);
    streamingRecognize(request: any): NodeJS.ReadWriteStream;
  }
}