# Colour review coverage

The application has **eight views**: six red–green/blue–yellow screening examples, an ordinary reference and a grayscale contrast check.

| Button | Meaning | Implementation |
| --- | --- | --- |
| Ordinary | Original colour reference | No transform |
| Grayscale | Contrast without hue | Linear-sRGB luminance |
| Protan model | Protanopia-style complete-loss screening | Machado setting 1.0 |
| Protanomaly | Partial protan example | Published Machado setting 0.5 |
| Deutan model | Deuteranopia-style complete-loss screening | Machado setting 1.0 |
| Deuteranomaly | Partial deutan example | Published Machado setting 0.5 |
| Tritan model | Tritanopia-style complete-loss screening | Brettel dual-plane projection |
| Tritanomaly | Partial tritan approximation | 0.5 interpolation with ordinary in linear light |

Short names stay on controls. Definitions, settings and limits are under **About these views**. Brief buttons are **Print / PDF**, **CSV** and **JSON**, with the longer explanation under **About this brief**.

## Scope

[The National Eye Institute](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/color-blindness/types-color-vision-deficiency) describes the four red–green subtypes, two blue–yellow subtypes and complete colour-vision deficiency. Grayscale represents only colour removal; it does not model all effects of achromatopsia or monochromacy, including acuity or light-sensitivity differences. Rare forms, acquired conditions, individual variation and every severity are not reproduced by this interface.

Setting 0.5 is a model parameter, not “50% vision”. It is a representative partial-loss example, not the entire range of that condition. The partial tritan interpolation is especially approximate. These are screening aids, not medical simulations personalized to an individual, a diagnosis or physical kit-visibility certification.

## Why the models differ

The red–green views use Machado coefficients and published partial-loss matrices. Tritan uses the Brettel method from the primary [libDaltonLens implementation](https://github.com/DaltonLens/libDaltonLens/blob/master/libDaltonLens.c). Numerical source attribution and licenses are in [third-party notices](../THIRD_PARTY_NOTICES.md).

## Existing work

No new YouCam image is needed. Accepted current renders and existing confirmed polygons remain usable. Region geometry is now versioned separately from screening coverage.

Migration `0004_expanded_screening_views.sql` marks prior plans and old-coverage reviews outdated. It preserves images, outlines, frozen brief values and review history. Refresh the application and restart the worker after updating; inspect all eight views, record a current decision, then recompute and confirm a current plan. Existing historical briefs remain readable. No old four-view approval silently qualifies as an eight-view review.

The server validates the full mode set, not only the UI's counter. Tests cover both tritan projection planes, partial red–green coefficients, alpha/gamut behavior, incomplete coverage, legacy-outline reuse and historical export behavior.
