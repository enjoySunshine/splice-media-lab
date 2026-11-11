import { getTrackAsWebVTT } from '../entries/all';
import { getFilePath, loadAndGetInfo } from './common';

async function exportTrack(name: string, trackIndex = 0) {
  const { testFile } = getFilePath('isobmff', name);
  const { info, mp4 } = await loadAndGetInfo(testFile, true, true);
  return getTrackAsWebVTT(mp4, info.tracks[trackIndex].id);
}

describe('getTrackAsWebVTT', () => {
  it('exports a tx3g track as WebVTT, decoding UTF-8 and mapping styles', async () => {
    const vtt = await exportTrack('22_tx3g.mp4');
    expect(vtt).toBe(
      `WEBVTT

00:00:01.262 --> 00:00:02.787
This is a sub-title
on 2 lines

00:00:03.418 --> 00:00:04.817
<i>with italic support</i>

00:00:05.986 --> 00:00:06.419
<b>and also bold</b>

00:00:07.223 --> 00:00:08.487
<b><i>and even bold
italic lines...</i></b>

00:00:09.223 --> 00:00:10.487
and unicode: é ï ö Ä
`,
    );
  });

  it('exports UTF-8 text without mojibake', async () => {
    const vtt = await exportTrack('22_tx3g.mp4');
    expect(vtt).toContain('and unicode: é ï ö Ä');
    expect(vtt).not.toContain('Ã');
  });

  it('maps tx3g bold/italic/bold+italic to WebVTT tags', async () => {
    const vtt = await exportTrack('22_tx3g.mp4');
    expect(vtt).toContain('<i>with italic support</i>');
    expect(vtt).toContain('<b>and also bold</b>');
    expect(vtt).toContain('<b><i>and even bold');
  });

  it('does not emit cues for empty tx3g samples', async () => {
    const vtt = await exportTrack('22_tx3g.mp4');
    // 10 samples, 5 of them empty -> exactly 5 cues
    expect(vtt.split('\n\n').filter(block => block.includes('-->'))).toHaveLength(5);
  });

  it('exports a tx3g track without style boxes', async () => {
    const vtt = await exportTrack('09_text.mp4');
    expect(vtt).toBe(
      `WEBVTT

00:00:00.000 --> 00:00:02.000
3GPP Text Sample

00:00:04.000 --> 00:00:06.000
3GPP Bold Text Sample
`,
    );
  });

  it('exports a wvtt track preserving header, ids, settings, voices and comments', async () => {
    const vtt = await exportTrack('16_vtt.mp4');
    expect(vtt).toBe(
      `WEBVTT
Some dummy header information

NOTE a comment before the first cue

1
00:00:11.000 --> 00:00:12.500 align:start line:10
<v Roger Bingham>We are in New York City.
We are looking straight down 5th Avenue.

00:00:13.000 --> 00:00:18.000
<v Neil DeGrass Tyson>Didn't you already say that?

NOTE some comment between cues
`,
    );
  });

  it('keeps the wvtt file header and NOTE comments', async () => {
    const vtt = await exportTrack('16_vtt.mp4');
    expect(vtt).toContain('WEBVTT\nSome dummy header information');
    expect(vtt).toContain('NOTE a comment before the first cue');
    expect(vtt).toContain('NOTE some comment between cues');
  });

  it('keeps wvtt cue identifiers, settings and voice tags', async () => {
    const vtt = await exportTrack('16_vtt.mp4');
    expect(vtt).toContain('1\n00:00:11.000 --> 00:00:12.500 align:start line:10');
    expect(vtt).toContain('<v Roger Bingham>');
    expect(vtt).toContain('<v Neil DeGrass Tyson>');
  });

  it('does not emit cues for empty wvtt samples (vtte)', async () => {
    const vtt = await exportTrack('16_vtt.mp4');
    // 5 samples: vtta, vttc, vtte, vttc, vtta -> exactly 2 cues
    expect(vtt.split('\n\n').filter(block => block.includes('-->'))).toHaveLength(2);
  });

  it('throws for an unknown track id', async () => {
    const { testFile } = getFilePath('isobmff', '22_tx3g.mp4');
    const { mp4 } = await loadAndGetInfo(testFile, true, true);
    expect(() => getTrackAsWebVTT(mp4, 999)).toThrow('Track 999 not found');
  });

  it('throws for a track that is not a tx3g or wvtt subtitle track', async () => {
    const { testFile } = getFilePath('isobmff', '01_simple.mp4');
    const { info, mp4 } = await loadAndGetInfo(testFile, true, true);
    expect(() => getTrackAsWebVTT(mp4, info.tracks[0].id)).toThrow(
      /not a tx3g or wvtt subtitle track/,
    );
  });
});
