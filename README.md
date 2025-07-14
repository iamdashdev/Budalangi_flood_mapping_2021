# Budalang’i Flood Mapping 2021 (Sentinel-1 SAR)

This project maps flooded areas in Budalang’i Constituency, Kenya during the March–May 2021 long rains, using Sentinel-1 SAR data and Google Earth Engine.

## Steps:
- Selected before (Jan–Feb 2021) and after (April–May 2021) SAR images
- Applied Refined Lee speckle filter
- Created RGB composites (VV, VH, VV/VH ratio)
- Detected flooded areas using backscatter ratio (>1.25)
- Removed permanent water & steep slope areas
- Exported:
  - RGB before & after images (GeoTIFF)
  - Flood extent shapefile




