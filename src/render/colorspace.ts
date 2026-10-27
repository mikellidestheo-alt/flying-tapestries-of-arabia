// The game's own shaders output raw colour values, which is how the palettes were tuned. The bloom
// pipeline renders into a linear target and converts to sRGB at the end (OutputPass), so while it is
// active these shaders convert their output to linear first and look exactly the same.
export const linearOut = { value: 0 };

export const TO_LINEAR_GLSL = /* glsl */ `
  uniform float linearOut;
  vec3 toLinearOut(vec3 c) {
    if (linearOut < 0.5) return c;
    vec3 lo = c * 0.0773993808;
    vec3 hi = pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4));
    return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
  }
`;
