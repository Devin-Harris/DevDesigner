/** A sequence diagram's layout at drag start, as `shiftSequence` expects it. */
export interface SequenceStart {
   xs: Map<string, number>;
   originY: number;
   rows: Map<string, number>;
}
