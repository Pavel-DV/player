const framesBoth = Object.freeze([
  String.raw`   <(^_^<)      `,
  String.raw`    \(^_^)/     `,
  String.raw`     (>^_^)>      `,
  String.raw`    /(^_^)\     `,

  String.raw`   c(='.'=)o     `,
  String.raw`   \(='.'=)/    `,
  String.raw`   c(='.'=)o   `,
  String.raw`   /(='.'=)\    `,

  String.raw`  <(=^_^=)>     `,
  String.raw`   \(=^_^=)/    `,
  String.raw`  <(=^_^=)>   `,
  String.raw`   /(=^_^=)\    `,

  String.raw`  ( . )( . )    `,
  String.raw`   ( . )( . )   `,
  String.raw`  ( . )( . )  `,
  String.raw`   ( . )( . )   `,

  String.raw`    U(^_^)U      `,
  String.raw`    U(o_o)U     `,
  String.raw`    U(^_^)U    `,
  String.raw`    U(o_o)U     `,

  String.raw`    \[o_o]/      `,
  String.raw`    -[O_O]-     `,
  String.raw`    \[o_o]/    `,
  String.raw`    -[O_O]-     `,

  String.raw`    d(o_o)p      `,
  String.raw`    q(O_O)p     `,
  String.raw`    q(o_o)b    `,
  String.raw`    q(O_O)p     `,

  String.raw`    \<o_o>/      `,
  String.raw`    -<O_O>-     `,
  String.raw`    \<o_o>/    `,
  String.raw`    /<O_O>\     `,

  String.raw`  <@('_')@>     `,
  String.raw`   \@(o_o)@/    `,
  String.raw`  <@('_')@>   `,
  String.raw`   /@(o_o)@\    `,

  String.raw`  <(*(oo)*)>    `,
  String.raw`   \(*(oo)*)/   `,
  String.raw`  <(*(oo)*)>  `,
  String.raw`   /(*(oo)*)\   `,
  
  String.raw`   ><(((('>     `,
  String.raw`    ><(((('>    `,
  String.raw`     <'((((><   `,
  String.raw`    <'((((><    `,

  String.raw`    \(o.o)/      `,
  String.raw`     (O.O)       `,
  String.raw`    \(o.o)/    `,
  String.raw`    /(O.O)\     `,

  String.raw`   <(^v^)>      `,
  String.raw`    \(^v^)/     `,
  String.raw`   <(^v^)>    `,
  String.raw`    /(^v^)\     `,

  String.raw`  (  .  Y  .  )  `,
  String.raw`   (  .  Y  .  ) `,
  String.raw`  (  .  Y  .  )  `,
  String.raw`   (  .  Y  .  ) `,

  String.raw`    //O\\       `,
  String.raw`     //O\\      `,
  String.raw`    //O\\     `,
  String.raw`     //O\\      `,

  String.raw`    \(*_*)/      `,
  String.raw`     (^_^)       `,
  String.raw`   <(o_o)>    `,
  String.raw`    /(^_^)\     `,

  String.raw`   \ (*_*) /    `,
  String.raw`   - (o_o) -    `,
  String.raw`   / (^_^) \    `,
  String.raw`   - (⌐_⌐) -    `,

  String.raw`  [$̲̅(5)$̲̅]    `,
  String.raw`   [$̲̅(5)$̲̅]   `,
  String.raw`  [$̲̅(5)$̲̅]  `,
  String.raw`   [$̲̅(5)$̲̅]   `,

  String.raw`    (~_^)       `,
  String.raw`     (^_~)      `,
  String.raw`    (~_^)       `,
  String.raw`     (^_~)      `,

  String.raw`   ┏(-_°)┛     `,
  String.raw`   ┗(°_°)┛     `,
  String.raw`   ┗(°_-)┓     `,
  String.raw`   ┏(-_-)┓     `,
]);

const framesPhoneOnly = Object.freeze([
  String.raw`  (  ͡° ͜ʖ ͡°)   `,
  String.raw`   (  ͡° ͜ʖ ͡°)  `,
  String.raw`  (  ͡° ͜ʖ ͡°) `,
  String.raw`   (  ͡° ͜ʖ ͡°)  `,

  // (͡° ͜໒ ͡° )
  String.raw`  (°͡ ໒͜ °͡  )   `,
  String.raw`   (°͡ ໒͜ °͡  )  `,
  String.raw`  (°͡ ໒͜ °͡  ) `,
  String.raw`   (°͡ ໒͜ °͡  )  `, 

  String.raw`  ¯\_(ツ)_/¯     `,
  String.raw`   ¯\_(ツ)_/¯    `,
  String.raw`  ¯\_(ツ)_/¯   `,
  String.raw`   ¯\_(ツ)_/¯    `,

  String.raw`    ʕ•ᴥ•ʔ       `,
  String.raw`     ʕ•ᴥ•ʔ      `,
  String.raw`    ʕ•ᴥ•ʔ     `,
  String.raw`     ʕ•ᴥ•ʔ      `,

  String.raw`     ಠ_ಠ        `,
  String.raw`      ಠ_ಠ       `,
  String.raw`     ಠ_ಠ      `,
  String.raw`      ಠ_ಠ       `,

  String.raw`   (▀̿Ĺ̯▀̿ ̿)    `,
  String.raw`    (▀̿Ĺ̯▀̿ ̿)   `,
  String.raw`   (▀̿Ĺ̯▀̿ ̿)  `,
  String.raw`    (▀̿Ĺ̯▀̿ ̿)   `,

  String.raw`  (づ｡◕‿‿◕｡)づ    `,
  String.raw`   (づ｡◕‿‿◕｡)づ   `,
  String.raw`  (づ｡◕‿‿◕｡)づ  `,
  String.raw`   (づ｡◕‿‿◕｡)づ   `,

  String.raw`   (ง'̀-'́)ง     `,
  String.raw`    (ง'̀-'́)ง    `,
  String.raw`   (ง'̀-'́)ง   `,
  String.raw`    (ง'̀-'́)ง    `,

  String.raw`  \ (•◡•) /     `,
  String.raw`   \ (•◡•) /    `,
  String.raw`  \ (•◡•) /   `,
  String.raw`   \ (•◡•) /    `,

  String.raw`   (╯°□°)╯      `,
  String.raw`    (╯°□°)╯     `,
  String.raw`   (╯°□°)╯    `,
  String.raw`    (╯°□°)╯     `,

  String.raw`    (¬‿¬)       `,
  String.raw`     (¬‿¬)      `,
  String.raw`    (¬‿¬)     `,
  String.raw`     (¬‿¬)      `,

  String.raw`    (ᵔᴥᵔ)       `,
  String.raw`     (ᵔᴥᵔ)      `,
  String.raw`    (ᵔᴥᵔ)     `,
  String.raw`     (ᵔᴥᵔ)      `,

  String.raw`  ¯\_(o‿o)_/¯    `,
  String.raw`  ¯\_(^‿^)_/¯   `,
  String.raw`  ¯\_('‿')_/¯  `,
  String.raw`  ¯\_(•‿•)_/¯   `,
  String.raw`  ¯\_(°‿°)_/¯    `,

  String.raw`    (◕‿◕✿)      `,
  String.raw`     (◕‿◕✿)     `,
  String.raw`    (◕‿◕✿)    `,
  String.raw`     (◕‿◕✿)     `,

  String.raw`     ಠ╭╮ಠ       `,
  String.raw`      ಠ╭╮ಠ      `,
  String.raw`     ಠ╭╮ಠ     `,
  String.raw`      ಠ╭╮ಠ      `,

  String.raw`   ╚(ಠ_ಠ)╗      `,
  String.raw`   ╚(ಠ_ಠ)╝     `,
  String.raw`   ╔(ಠ_ಠ)╝    `,
  String.raw`   ╔(ಠ_ಠ)╗     `,

  String.raw`     ʘ‿ʘ        `,
  String.raw`      ʘ‿ʘ       `,
  String.raw`     ʘ‿ʘ      `,
  String.raw`      ʘ‿ʘ       `,

  String.raw`    (◑‿◑)       `,
  String.raw`     (◐‿◐)      `,
  String.raw`    (◑‿◑)     `,
  String.raw`     (◐‿◐)      `,

  String.raw`  ʕ ͡° ʖ̯ ͡°ʔ    `,
  String.raw`   ʕ ͡° ʖ̯ ͡°ʔ   `,
  String.raw`  ʕ ͡° ʖ̯ ͡°ʔ  `,
  String.raw`   ʕ ͡° ʖ̯ ͡°ʔ   `,

  String.raw`  ( ͡° ᴥ ͡°)    `,
  String.raw`   ( ͡° ᴥ ͡°)   `,
  String.raw`  ( ͡° ᴥ ͡°)  `,
  String.raw`   ( ͡° ᴥ ͡°)   `,

  String.raw` (☞ ͡° ͜ʖ ͡°)☞   `,
  String.raw`  (☞ ͡° ͜ʖ ͡°)☞  `,
  String.raw` (☞ ͡° ͜ʖ ͡°)☞ `,
  String.raw`  (☞ ͡° ͜ʖ ͡°)☞  `,

  String.raw` ᕙ(▀̿ĺ̯▀̿ ̿)ᕗ   `,
  String.raw`  ᕙ(▀̿ĺ̯▀̿ ̿)ᕗ  `,
  String.raw` ᕙ(▀̿ĺ̯▀̿ ̿)ᕗ `,
  String.raw`  ᕙ(▀̿ĺ̯▀̿ ̿)ᕗ  `,

  String.raw`  ( ͡°👅 ͡°)    `,
  String.raw`   ( ͡°👅 ͡°)   `,
  String.raw`  ( ͡°👅 ͡°)  `,
  String.raw`   ( ͡°👅 ͡°)   `,

  String.raw`  ( ◔ ʖ̯ ◔ )    `,
  String.raw`   ( ◔ ʖ̯ ◔ )   `,
  String.raw`  ( ◔ ʖ̯ ◔ )  `,
  String.raw`   ( ◔ ʖ̯ ◔ )   `,

  String.raw`   (｢•-•)｢      `,
  String.raw`    (｢•-•)｢     `,
  String.raw`   (｢•-•)｢    `,
  String.raw`    (｢•-•)｢     `,

  String.raw`  ( ཀ ʖ̯ ཀ)     `,
  String.raw`   ( ཀ ʖ̯ ཀ)    `,
  String.raw`  ( ཀ ʖ̯ ཀ)   `,
  String.raw`   ( ཀ ʖ̯ ཀ)    `,

  String.raw`    (⌐□_□)      `,
  String.raw`     (⌐□_□)     `,
  String.raw`    (⌐□_□)    `,
  String.raw`     (⌐□_□)     `,
]);

const framesCarOnly = Object.freeze([
  String.raw`  ¯\_(o‿  o)_/¯    `,
  String.raw`  ¯\_(^‿  ^)_/¯   `,
  String.raw`  ¯\_('‿  ')_/¯  `,
  String.raw`  ¯\_(•‿  •)_/¯   `,
  String.raw`  ¯\_(°‿  °)_/¯    `,

  String.raw`   (¬‿  ¬)      `, //  для радио добавил два пробела после нижней скобки
  String.raw`    (¬‿  ¬)     `,
  String.raw`   (¬‿  ¬)    `,
  String.raw`    (¬‿  ¬)     `,

  String.raw` ¯\_(o‿  o)_/¯   `,
  String.raw` ¯\_(^‿  ^)¯\_  `,
  String.raw` _/¯('‿  ')¯\_ `,
  String.raw` _/¯(•‿  •)_/¯  `,
  String.raw` ¯\_(°‿  °)_/¯   `,
]);

const carFrames = Object.freeze([
  ...framesBoth,
  ...framesCarOnly,
]);

const phoneFrames = Object.freeze([
  ...framesBoth,
  ...framesPhoneOnly,
]);

const ARTIST_ANIMATION_FRAME_SKIP_COUNT_CAR = 3;
const ARTIST_ANIMATION_FRAME_SKIP_COUNT_PHONE = 0;

export function createArtistAnimation(getCarArtworkEnabled) {
  let index = 0;
  let frame = '';
  let frameChecksToSkip = 0;

  return () => {
    const carArtworkEnabled = getCarArtworkEnabled();
    const frameSkipCount = carArtworkEnabled
      ? ARTIST_ANIMATION_FRAME_SKIP_COUNT_CAR
      : ARTIST_ANIMATION_FRAME_SKIP_COUNT_PHONE;

    if (frameChecksToSkip > 0) {
      frameChecksToSkip -= 1;
      return frame;
    }

    const frames = carArtworkEnabled ? carFrames : phoneFrames;
    frameChecksToSkip = frameSkipCount;
    frame = frames[index % frames.length];
    index = (index + 1) % frames.length;

    return frame;
  };
}
