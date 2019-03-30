import React from 'react';

enum SoundStatus {
  PAUSED = 'PAUSED',
  PLAYING = 'PLAYING',
  STOPPED = 'STOPPED',
}

type OnPlayingArgs = {
  position: number;
  duration: number;
};

/**
 * Sound Props
 */
export interface ISoundProps {
  url: string;
  playStatus: string;
  position: number;
  /** volume */
  volume: number;
  onPlaying: (args: OnPlayingArgs) => void;
  onFinishedPlaying?: (event: any) => void;
  onLoading?: (event: any) => void;
  onLoad?: (event: any) => void;
  onVisualizationChange?: (data: number[]) => void;
  equalizer?: Record<string, number>;
  preAmp?: number;
  stereoPan?: number;
}

/**
 * Sound Component
 */
export class Sound extends React.Component<ISoundProps> {
  audio: HTMLAudioElement;
  audioContext: AudioContext;
  gainNode: GainNode;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[] = [];
  analyser: AnalyserNode;
  stereoPanner: StereoPannerNode;
  qValues: Array<number | null>;
  frequencyData: Uint8Array;
  animationFrame: number;

  static status = SoundStatus;

  constructor(props: ISoundProps) {
    super(props);

    this.handleVisualizationChange = this.handleVisualizationChange.bind(this);
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.attachRef = this.attachRef.bind(this);
  }

  attachRef(element: HTMLAudioElement) {
    if (element) {
      this.audio = element;
    }
  }

  createFilterNodes() {
    let lastInChain = this.gainNode;
    const { equalizer, preAmp = 0 } = this.props;

    if (equalizer) {
      this.qValues = Object.keys(equalizer).map((freq, i, arr) => {
        if (!i || i === arr.length - 1) {
          return null;
        } else {
          return (2 * Number(freq)) / Math.abs(Number(arr[i + 1]) - Number(arr[i - 1]));
        }
      });

      Object.keys(equalizer).forEach((freq, i, arr) => {
        const biquadFilter = this.audioContext.createBiquadFilter();

        biquadFilter.type = 'peaking';
        biquadFilter.frequency.value = Number(freq);
        biquadFilter.gain.value = equalizer[freq] + preAmp;

        if (!i || i === arr.length - 1) {
          biquadFilter.type = i ? 'highshelf' : 'lowshelf';
        } else {
          biquadFilter.Q.value = this.qValues[i] as number;
        }

        if (lastInChain) {
          lastInChain.connect(biquadFilter);
        }

        lastInChain = biquadFilter;

        this.filters.push(biquadFilter);
      });
    }

    return lastInChain;
  }

  formatDataVizByFrequency(data: Uint8Array) {
    const { equalizer } = this.props;
    const values = [];
    let currentIndex = 0;
    const HERTZ_ITER = 23.4;

    if (equalizer) {
      const frequencies = Object.keys(equalizer).map(Number);
      for (let i = 0; i <= frequencies[frequencies.length - 1] + HERTZ_ITER; i = i + HERTZ_ITER) {
        const freq = frequencies[currentIndex];

        if (i > freq && i < freq + HERTZ_ITER) {
          currentIndex++;

          values.push(data[Math.round(i / HERTZ_ITER)]);
        }
      }
    }

    return values;
  }

  handleVisualizationChange() {
    this.animationFrame = requestAnimationFrame(this.handleVisualizationChange);
    this.analyser.getByteFrequencyData(this.frequencyData);

    if (this.props.onVisualizationChange) {
      this.props.onVisualizationChange(this.formatDataVizByFrequency(this.frequencyData));
    }
  }

  handleTimeUpdate({ target }: any) {
    this.props.onPlaying({
      position: target.currentTime,
      duration: target.duration,
    });
  }

  setPlayerState() {
    switch (this.props.playStatus) {
      case Sound.status.PAUSED:
        // this.audioContext.suspend();
        this.audio.pause();
        cancelAnimationFrame(this.animationFrame);
        break;
      case Sound.status.PLAYING:
        this.audio
          .play()
          .then(
            () =>
              !!this.props.onVisualizationChange &&
              !!this.props.equalizer &&
              this.handleVisualizationChange(),
          )
          .catch(console.error);
        break;
      case Sound.status.STOPPED:
        this.audio.pause();
        this.audio.currentTime = 0;
        cancelAnimationFrame(this.animationFrame);
        break;
    }
  }

  shouldUpdatePosition(previousPosition: number) {
    const dif = this.props.position - previousPosition;

    return this.props.position < previousPosition || dif > 1;
  }

  shouldUpdateEqualizer(prevProps: ISoundProps) {
    const { equalizer, preAmp } = this.props;

    return (
      equalizer &&
      prevProps.equalizer &&
      !(
        Object.entries(equalizer).toString() ===
        Object.entries(prevProps.equalizer).toString()
      )
    ) ||
    preAmp !== prevProps.preAmp
  }

  setVolume() {
    this.gainNode.gain.value = this.props.volume / 100;
  }

  setPosition() {
    this.audio.currentTime = this.props.position;
  }

  setStereoPan() {
    this.stereoPanner.pan.value = this.props.stereoPan || 0;
  }

  componentDidUpdate(prevProps: ISoundProps) {
    const {
      volume,
      playStatus,
      equalizer = {},
      preAmp = 0,
      stereoPan = 0
    } = this.props;

    if (volume !== prevProps.volume) {
      this.setVolume();
    }

    if (this.shouldUpdatePosition(prevProps.position)) {
      this.setPosition();
    }

    if (playStatus !== prevProps.playStatus) {
      this.setPlayerState();
    }

    if (stereoPan !== prevProps.stereoPan) {
      this.setStereoPan();
    }

    if (this.shouldUpdateEqualizer(prevProps)) {
      Object.values(equalizer).forEach((value, idx) => {
        this.filters[idx].gain.value = value + preAmp;
      });
    }
  }

  componentDidMount() {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.stereoPanner = new StereoPannerNode(
      this.audioContext,
      { pan: this.props.stereoPan || 0 }
    );
    this.source = this.audioContext.createMediaElementSource(this.audio);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 32768;
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);

    this.source.connect(this.gainNode);
    this.createFilterNodes()
      .connect(this.analyser)
      .connect(this.stereoPanner)
      .connect(this.audioContext.destination);

    this.setVolume();
    this.setPlayerState();
    this.setStereoPan();
  }

  render() {
    return (
      <audio
        crossOrigin="anonymous"
        style={{ visibility: 'hidden' }}
        src={this.props.url}
        ref={this.attachRef}
        onTimeUpdate={this.handleTimeUpdate}
        onEnded={this.props.onFinishedPlaying}
        onLoadStart={this.props.onLoading}
        onLoad={this.props.onLoad}
      />
    );
  }
}
