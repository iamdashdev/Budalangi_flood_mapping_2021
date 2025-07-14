// Select images by predefined dates
//7 May 2024 — Residents of Sigiri wade through flood waters in Budalangi on 7th May 2024. The floods were caused by an overflow from Lake Victoria due to ...
var beforeStart = "2021-01-01";
var beforeEnd = "2021-03-01";
var afterStart = "2021-04-05";
var afterEnd = "2021-05-20";

var budalangi = constituencies.filter(ee.Filter.eq("CONSTITUEN", "BUDALANGI"));
var geometry = budalangi.geometry();
Map.addLayer(geometry, { color: "blue" }, "Budalangi Constituency");

var filtered = s1
	.filter(ee.Filter.eq("instrumentMode", "IW"))
	.filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
	.filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
	.filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING"))
	.filter(ee.Filter.eq("resolution_meters", 10))
	.filter(ee.Filter.bounds(geometry))
	.select(["VV", "VH"]);

var beforeCollection = filtered.filter(ee.Filter.date(beforeStart, beforeEnd));
var afterCollection = filtered.filter(ee.Filter.date(afterStart, afterEnd));

var listDates = filtered
	.aggregate_array("system:time_start")
	.map(function (time) {
		return ee.Date(time).format("YYYY-MM-dd");
	});
print("Available image dates:", listDates);

print(filtered.first());
print(filtered.size());

print(beforeCollection.size());
print(afterCollection.size());
var before = beforeCollection.mosaic().clip(geometry);
var after = afterCollection.mosaic().clip(geometry);

var addRatioBand = function (image) {
	var ratioBand = image.select("VV").divide(image.select("VH")).rename("VV/VH");
	return image.addBands(ratioBand);
};

var beforeRgb = addRatioBand(before);
var afterRgb = addRatioBand(after);

var visParams = {
	min: [-25, -25, 0],
	max: [0, 0, 2]
};

Map.addLayer(beforeRgb, visParams, "Before");
Map.addLayer(afterRgb, visParams, "After");

// Export BEFORE composite to Drive
Export.image.toDrive({
	image: beforeRgb,
	description: "Budalangi_Before_RGB",
	folder: "EarthEngine",
	fileNamePrefix: "Budalangi_Before_RGB",
	region: geometry,
	scale: 10,
	maxPixels: 1e13
});

// Export AFTER composite to Drive
Export.image.toDrive({
	image: afterRgb,
	description: "Budalangi_After_RGB",
	folder: "EarthEngine",
	fileNamePrefix: "Budalangi_After_RGB",
	region: geometry,
	scale: 10,
	maxPixels: 1e13
});
