// Motion's feature bundle, in its own chunk so LazyMotion can fetch it after paint.
//
// `domMax` rather than the lighter `domAnimation` because the TabBar's active underline
// is a shared-layout animation (`layoutId`), which the animation-only bundle doesn't
// include. Everything else in the app is enter/exit + transform/opacity.
import { domMax } from "motion/react";

export default domMax;
