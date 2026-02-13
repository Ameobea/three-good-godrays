# Changelog

## 0.10.0

### Breaking Changes

The `edgeStrength` and `edgeRadius` params from `GodraysPassParams` have been removed, and a new `upsampleQuality` has been added to replace it.

The compositor pass now uses "Joint bilateral upsampling" which provides _much_ better results compared to the original method.  It should have a similar or lower performance impact as well.

Old code should continue working and will use the default value (`GodraysUpsampleQuality.HIGH`).
