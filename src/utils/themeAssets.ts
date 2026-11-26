import type { BgImageKey, BgTheme } from '../../shared/questions.ts';
import bgSpaceImg from '../assets/images/bg_space_1794650810303.jpg';
import bgScienceImg from '../assets/images/bg_science_1794650810316.jpg';
import bgTechImg from '../assets/images/bg_tech_1794650811745.jpg';
import bgHistoryImg from '../assets/images/bg_history_1794650812363.jpg';
import bgGeographyImg from '../assets/images/bg_geography_1794650812395.jpg';
import bgArtsMathImg from '../assets/images/bg_arts_math_1794650813050.jpg';
import qEinsteinPhysicsImg from '../assets/images/q_einstein_physics_1794654466125.jpg';
import qQuantumAtomImg from '../assets/images/q_quantum_atom_1794654467993.jpg';
import qMarsPlanetImg from '../assets/images/q_mars_planet_1794654467343.jpg';
import qBlackHoleImg from '../assets/images/q_black_hole_1794654467972.jpg';
import qApolloMoonImg from '../assets/images/q_apollo_moon_1794654468973.jpg';
import qDnaBiologyImg from '../assets/images/q_dna_biology_1794654468738.jpg';
import qCrystalChemistryImg from '../assets/images/q_crystal_chemistry_1794654469509.jpg';
import qPyramidsEgyptImg from '../assets/images/q_pyramids_egypt_1794654470182.jpg';
import qPersepolisIranImg from '../assets/images/q_persepolis_iran_1794654469669.jpg';
import qEverestPeaksImg from '../assets/images/q_everest_peaks_1794654470485.jpg';
import qDeepOceanImg from '../assets/images/q_deep_ocean_1794654471413.jpg';
import qCpuChipImg from '../assets/images/q_cpu_chip_1794654471123.jpg';
import qNetworkAiImg from '../assets/images/q_network_ai_1794654472225.jpg';
import qRenaissanceArtImg from '../assets/images/q_renaissance_art_1794654472768.jpg';

export interface ThemeVisualConfig {
  id: BgTheme;
  label: string;
  image: string;
  particleColor: string;
  glowGradient: string;
  badgeClasses: string;
}

export const THEME_VISUALS: Record<BgTheme, ThemeVisualConfig> = {
  space: {
    id: 'space',
    label: 'نجوم و کیهان',
    image: bgSpaceImg,
    particleColor: 'rgba(125, 211, 252, 0.8)',
    glowGradient: 'from-indigo-600/30 via-sky-500/15 to-slate-950/60',
    badgeClasses: 'text-sky-600 dark:text-sky-300',
  },
  science: {
    id: 'science',
    label: 'علوم و زیست‌شناسی',
    image: bgScienceImg,
    particleColor: 'rgba(52, 211, 153, 0.8)',
    glowGradient: 'from-emerald-600/25 via-teal-500/15 to-slate-950/60',
    badgeClasses: 'text-emerald-600 dark:text-emerald-300',
  },
  tech: {
    id: 'tech',
    label: 'فناوری و الگوریتم',
    image: bgTechImg,
    particleColor: 'rgba(96, 165, 250, 0.8)',
    glowGradient: 'from-blue-600/30 via-cyan-500/15 to-slate-950/60',
    badgeClasses: 'text-blue-600 dark:text-blue-300',
  },
  history: {
    id: 'history',
    label: 'تاریخ و تمدن',
    image: bgHistoryImg,
    particleColor: 'rgba(251, 191, 36, 0.78)',
    glowGradient: 'from-amber-600/25 via-orange-500/15 to-slate-950/60',
    badgeClasses: 'text-amber-600 dark:text-amber-300',
  },
  geography: {
    id: 'geography',
    label: 'جغرافیا و شگفتی زمین',
    image: bgGeographyImg,
    particleColor: 'rgba(45, 212, 191, 0.8)',
    glowGradient: 'from-teal-600/25 via-cyan-500/15 to-slate-950/60',
    badgeClasses: 'text-teal-600 dark:text-teal-300',
  },
  arts_math: {
    id: 'arts_math',
    label: 'هنر، فلسفه و ریاضی',
    image: bgArtsMathImg,
    particleColor: 'rgba(250, 204, 21, 0.78)',
    glowGradient: 'from-amber-500/25 via-indigo-500/15 to-slate-950/60',
    badgeClasses: 'text-amber-600 dark:text-amber-300',
  },
};

export const QUESTION_BG_IMAGES: Record<BgImageKey, { image: string; label: string }> = {
  space: { image: bgSpaceImg, label: 'اعماق فضا و رصدخانه' },
  science: { image: bgScienceImg, label: 'آزمایشگاه علوم و شیمی' },
  tech: { image: bgTechImg, label: 'فناوری دیجیتال و وب' },
  history: { image: bgHistoryImg, label: 'اسناد و تاریخ جهان' },
  geography: { image: bgGeographyImg, label: 'جغرافیای کره زمین' },
  arts_math: { image: bgArtsMathImg, label: 'فرهنگ، ادبیات و منطق' },
  einstein_physics: { image: qEinsteinPhysicsImg, label: 'فیزیک اینشتین و نسبیت' },
  quantum_atom: { image: qQuantumAtomImg, label: 'فیزیک کوانتوم و اتم' },
  mars_planet: { image: qMarsPlanetImg, label: 'سیاره سرخ مریخ' },
  black_hole: { image: qBlackHoleImg, label: 'افق رویداد سیاه‌چاله' },
  apollo_moon: { image: qApolloMoonImg, label: 'کره ماه و مأموریت آپولو' },
  dna_biology: { image: qDnaBiologyImg, label: 'ساختار ژنتیک و زیست‌شناسی' },
  crystal_chemistry: { image: qCrystalChemistryImg, label: 'بلورشناسی و عناصر شیمیایی' },
  pyramids_egypt: { image: qPyramidsEgyptImg, label: 'اهرام مصر باستان' },
  persepolis_iran: { image: qPersepolisIranImg, label: 'تخت جمشید و میراث ایران' },
  everest_peaks: { image: qEverestPeaksImg, label: 'قله‌های هیمالیا و اورست' },
  deep_ocean: { image: qDeepOceanImg, label: 'اعماق اقیانوس و آب‌ها' },
  cpu_chip: { image: qCpuChipImg, label: 'تراشه سیلیکونی و سخت‌افزار' },
  network_ai: { image: qNetworkAiImg, label: 'شبکه جهانی و هوش مصنوعی' },
  renaissance_art: { image: qRenaissanceArtImg, label: 'آتلیه رنسانس و نسبت طلایی' },
};

export function getBackdropVisual(theme: BgTheme, imageKey?: BgImageKey) {
  const base = THEME_VISUALS[theme] || THEME_VISUALS.space;
  const specific = (imageKey && QUESTION_BG_IMAGES[imageKey]) || QUESTION_BG_IMAGES[theme] || QUESTION_BG_IMAGES.space;
  return {
    key: imageKey || theme,
    image: specific.image,
    label: specific.label,
    particleColor: base.particleColor,
    glowGradient: base.glowGradient,
    badgeClasses: base.badgeClasses,
  };
}

export const PLAYER_AVATARS = ['🦊', '🚀', '🧠', '⚡', '🦉', '🌟', '🎯', '🐉'];

export const PLAYER_COLORS = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#e11d48',
  '#8b5cf6',
];
