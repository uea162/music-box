import type { Song } from "@/types/song";

// The catalog supplies genre rather than a mood tag. Give every candidate a
// short atmosphere description so Jev sees more than just its title.
export function songWithMood(song: Song): Song {
  const genre = (song.genre ?? "").toLowerCase();
  let mood = "旋律感鲜明，适合日常街景、室内光线与平静心绪";
  if (/ambient|new age|氛围/.test(genre)) mood = "空灵舒缓、留白较多，适合安静室内、晨雾与独处";
  else if (/classical|古典|soundtrack|配乐/.test(genre)) mood = "层次舒展、带电影感，适合开阔风景、暮色与沉思";
  else if (/jazz|爵士|blues|蓝调/.test(genre)) mood = "慵懒而温暖，适合咖啡馆、暖灯与雨后街道";
  else if (/electronic|电子|dance|舞曲/.test(genre)) mood = "有律动和空间感，适合城市夜景、霓虹与流动光影";
  else if (/r&b|soul|靈魂|灵魂/.test(genre)) mood = "温柔顺滑、带亲密感，适合室内暖光、黄昏与放松心情";
  else if (/rock|搖滾|摇滚|alternative|另类/.test(genre)) mood = "有张力与推进感，适合户外道路、阴天与情绪起伏";
  else if (/folk|country|民謠|民谣|乡村/.test(genre)) mood = "自然质朴，适合阳光、树木、郊外与缓慢步调";
  else if (/hip-hop|rap|说唱/.test(genre)) mood = "节奏鲜明、带城市感，适合街头、人群与夜晚灯光";
  else if (/pop|流行|mandopop|cantopop/.test(genre)) mood = "旋律清晰、情绪亲近，适合城市日常、柔和光线与回忆";
  return { ...song, mood: song.mood ?? mood };
}
