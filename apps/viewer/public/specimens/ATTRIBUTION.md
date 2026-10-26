# Specimen Data Attribution & Provenance

## Clinical Benchmark Biopsy (`clinical_slide.webp`, `clinical_tiles/`)

* **Source**: OpenSlide Benchmark Dataset (`CMU-1-Small-Region.svs`)
* **Repository**: [OpenSlide Test Data Suite](https://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/)
* **Institution**: Carnegie Mellon University (CMU) & The OpenSlide Project
* **License**: **CC0 1.0 Universal (Public Domain Dedication)** — Carnegie Mellon University has waived all copyright and related or neighboring rights to the OpenSlide test dataset; freely redistributable without restriction.
* **Modality**: Brightfield Whole Slide Microscopy (Aperio SVS format)
* **Staining**: Hematoxylin and Eosin (H&E)
* **Pixel Resolution**: 2220 × 2967 px base overview (`clinical_slide.webp`) with pre-sliced 256×256 WebP Deep Zoom Image (DZI) pyramid (`clinical_tiles/{10,11,12}/`)
* **Usage**: Provided under public domain dedication for digital pathology visualization, whole-slide image viewing engines, and tele-pathology hardware simulation.

---

## Synthetic Benchmark Biopsy (`synthetic`)

* **Engine**: `@ishika/simulator` & `@ishika/vision` procedural tissue generator
* **Morphology**: Deterministic mathematical emulation of cellular nuclei, stroma matrix, and optical depth-of-field
* **License**: AGPLv3 (Included in Ishika Open Core)
