const SAMPLE_PACK_BASE = "./assets/audio/sample-pack";

const file = (path) => ({
  name: path.split("/").pop(),
  path,
  url: `${SAMPLE_PACK_BASE}/${path}`
});

export const DEFAULT_SAMPLE_PACK = {
  id: "default-pack",
  label: "Default Sample Pack",
  name: "Default Sample Pack",
  path: "",
  dirs: [
    {
      name: "drums",
      path: "drums",
      dirs: [],
      files: [
        file("drums/ra_clap_room.wav"),
        file("drums/ra_click_glass.wav"),
        file("drums/ra_hat_closed.wav"),
        file("drums/ra_hat_open.wav"),
        file("drums/ra_kick_deep.wav"),
        file("drums/ra_kick_soft.wav"),
        file("drums/ra_rim_wood.wav"),
        file("drums/ra_snare_dust.wav"),
        file("drums/ra_snare_tight.wav"),
        file("drums/ra_sub_drop.wav"),
        file("drums/ra_tom_high.wav"),
        file("drums/ra_tom_low.wav")
      ]
    },
    {
      name: "loops",
      path: "loops",
      dirs: [],
      files: Array.from({ length: 32 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        return file(`loops/ra_loop_${number}_118bpm.wav`);
      })
    },
    {
      name: "textures",
      path: "textures",
      dirs: [],
      files: [
        file("textures/ra_texture_01.wav"),
        file("textures/ra_texture_02.wav"),
        file("textures/ra_texture_03.wav"),
        file("textures/ra_texture_04.wav")
      ]
    }
  ],
  files: [
    file("hat.wav"),
    file("kick.wav"),
    file("rim.wav"),
    file("scratch.wav"),
    file("snare.wav")
  ]
};

export const DEFAULT_SAMPLE_ROOTS = [DEFAULT_SAMPLE_PACK];
