var beforeStart = "2021-01-01";
var beforeEnd = "2021-03-01";
var afterStart = "2021-04-05";
var afterEnd = "2021-06-16";

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
	.select("VH");

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

Map.addLayer(before, { min: -25, max: 0 }, "Before Floods", false);
Map.addLayer(after, { min: -25, max: 0 }, "After Floods", false);

var beforeFiltered = toDB(RefinedLee(toNatural(before)));
var afterFiltered = toDB(RefinedLee(toNatural(after)));

Map.addLayer(beforeFiltered, { min: -25, max: 0 }, "Before Floods", false);
Map.addLayer(afterFiltered, { min: -25, max: 0 }, "After Floods", false);

var difference = afterFiltered.divide(beforeFiltered);
var diffThreshold = 1.25;

var flooded = difference.gt(diffThreshold).rename("water").selfMask();
4;
Map.addLayer(
	flooded,
	{ min: 0, max: 1, palette: ["orange"] },
	"Initial Flood Estimate"
);

var permanentWater = gsw.select("seasonality").gte(5).clip(geometry);

var flooded = flooded.updateMask(permanentWater);
print(flooded);
var slopeThreshold = 5;
var terrain = ee.Algorithms.Terrain(hydrosheds);
var slope = terrain.select("slope");
var flooded = flooded.updateMask(slope.lt(slopeThreshold));

var connectedPixelsThreshold = 2;
var connections = flooded.connectedPixelCount(25);
var flooded = flooded.updateMask(connections.gt(connectedPixelsThreshold));

Map.addLayer(
	flooded,
	{ min: 0, max: 1, palette: ["red"] },
	"Flooded Area",
	true
);

print("Total District Area (Ha)", geometry.area().divide(10000));

var stats = flooded.multiply(ee.Image.pixelArea()).reduceRegion({
	reducer: ee.Reducer.sum(),
	geometry: geometry,
	scale: 10,
	maxPixels: 1e10,
	tileScale: 16
});
//print('Flooded Area (Ha)', ee.Number(stats.get('water')).divide(10000))

// If the above computation times out, you can export it
var flooded_area = ee.Number(stats.get("water")).divide(10000);
var feature = ee.Feature(null, { flooded_area: flooded_area });
var fc = ee.FeatureCollection([feature]);
//Export as Shapefile
var floodedVector = flooded.reduceToVectors({
	geometry: geometry,
	scale: 30,
	geometryType: "polygon",
	labelProperty: "water",
	maxPixels: 1e13
});

Export.table.toDrive({
	collection: floodedVector,
	description: "Budalangi_Flooded_Areas_2021",
	folder: "Flooded_Areas",
	fileFormat: "SHP"
});

//############################
// Speckle Filtering Functions
//############################

// Function to convert from dB
function toNatural(img) {
	return ee.Image(10.0).pow(img.select(0).divide(10.0));
}

//Function to convert to dB
function toDB(img) {
	return ee.Image(img).log10().multiply(10.0);
}

//Apllying a Refined Lee Speckle filter as coded in the SNAP 3.0 S1TBX:

//https://github.com/senbox-org/s1tbx/blob/master/s1tbx-op-sar-processing/src/main/java/org/esa/s1tbx/sar/gpf/filtering/SpeckleFilters/RefinedLee.java
//Adapted by Guido Lemoine

// by Guido Lemoine
function RefinedLee(img) {
	// img must be in natural units, i.e. not in dB!
	// Set up 3x3 kernels
	var weights3 = ee.List.repeat(ee.List.repeat(1, 3), 3);
	var kernel3 = ee.Kernel.fixed(3, 3, weights3, 1, 1, false);

	var mean3 = img.reduceNeighborhood(ee.Reducer.mean(), kernel3);
	var variance3 = img.reduceNeighborhood(ee.Reducer.variance(), kernel3);

	// Use a sample of the 3x3 windows inside a 7x7 windows to determine gradients and directions
	var sample_weights = ee.List([
		[0, 0, 0, 0, 0, 0, 0],
		[0, 1, 0, 1, 0, 1, 0],
		[0, 0, 0, 0, 0, 0, 0],
		[0, 1, 0, 1, 0, 1, 0],
		[0, 0, 0, 0, 0, 0, 0],
		[0, 1, 0, 1, 0, 1, 0],
		[0, 0, 0, 0, 0, 0, 0]
	]);

	var sample_kernel = ee.Kernel.fixed(7, 7, sample_weights, 3, 3, false);

	// Calculate mean and variance for the sampled windows and store as 9 bands
	var sample_mean = mean3.neighborhoodToBands(sample_kernel);
	var sample_var = variance3.neighborhoodToBands(sample_kernel);

	// Determine the 4 gradients for the sampled windows
	var gradients = sample_mean.select(1).subtract(sample_mean.select(7)).abs();
	gradients = gradients.addBands(
		sample_mean.select(6).subtract(sample_mean.select(2)).abs()
	);
	gradients = gradients.addBands(
		sample_mean.select(3).subtract(sample_mean.select(5)).abs()
	);
	gradients = gradients.addBands(
		sample_mean.select(0).subtract(sample_mean.select(8)).abs()
	);

	// And find the maximum gradient amongst gradient bands
	var max_gradient = gradients.reduce(ee.Reducer.max());

	// Create a mask for band pixels that are the maximum gradient
	var gradmask = gradients.eq(max_gradient);

	// duplicate gradmask bands: each gradient represents 2 directions
	gradmask = gradmask.addBands(gradmask);

	// Determine the 8 directions
	var directions = sample_mean
		.select(1)
		.subtract(sample_mean.select(4))
		.gt(sample_mean.select(4).subtract(sample_mean.select(7)))
		.multiply(1);
	directions = directions.addBands(
		sample_mean
			.select(6)
			.subtract(sample_mean.select(4))
			.gt(sample_mean.select(4).subtract(sample_mean.select(2)))
			.multiply(2)
	);
	directions = directions.addBands(
		sample_mean
			.select(3)
			.subtract(sample_mean.select(4))
			.gt(sample_mean.select(4).subtract(sample_mean.select(5)))
			.multiply(3)
	);
	directions = directions.addBands(
		sample_mean
			.select(0)
			.subtract(sample_mean.select(4))
			.gt(sample_mean.select(4).subtract(sample_mean.select(8)))
			.multiply(4)
	);
	// The next 4 are the not() of the previous 4
	directions = directions.addBands(directions.select(0).not().multiply(5));
	directions = directions.addBands(directions.select(1).not().multiply(6));
	directions = directions.addBands(directions.select(2).not().multiply(7));
	directions = directions.addBands(directions.select(3).not().multiply(8));

	// Mask all values that are not 1-8
	directions = directions.updateMask(gradmask);

	// "collapse" the stack into a singe band image (due to masking, each pixel has just one value (1-8) in it's directional band, and is otherwise masked)
	directions = directions.reduce(ee.Reducer.sum());

	//var pal = ['ffffff','ff0000','ffff00', '00ff00', '00ffff', '0000ff', 'ff00ff', '000000'];
	//Map.addLayer(directions.reduce(ee.Reducer.sum()), {min:1, max:8, palette: pal}, 'Directions', false);

	var sample_stats = sample_var.divide(sample_mean.multiply(sample_mean));

	// Calculate localNoiseVariance
	var sigmaV = sample_stats
		.toArray()
		.arraySort()
		.arraySlice(0, 0, 5)
		.arrayReduce(ee.Reducer.mean(), [0]);

	// Set up the 7*7 kernels for directional statistics
	var rect_weights = ee.List.repeat(ee.List.repeat(0, 7), 3).cat(
		ee.List.repeat(ee.List.repeat(1, 7), 4)
	);

	var diag_weights = ee.List([
		[1, 0, 0, 0, 0, 0, 0],
		[1, 1, 0, 0, 0, 0, 0],
		[1, 1, 1, 0, 0, 0, 0],
		[1, 1, 1, 1, 0, 0, 0],
		[1, 1, 1, 1, 1, 0, 0],
		[1, 1, 1, 1, 1, 1, 0],
		[1, 1, 1, 1, 1, 1, 1]
	]);

	var rect_kernel = ee.Kernel.fixed(7, 7, rect_weights, 3, 3, false);
	var diag_kernel = ee.Kernel.fixed(7, 7, diag_weights, 3, 3, false);

	// Create stacks for mean and variance using the original kernels. Mask with relevant direction.
	var dir_mean = img
		.reduceNeighborhood(ee.Reducer.mean(), rect_kernel)
		.updateMask(directions.eq(1));
	var dir_var = img
		.reduceNeighborhood(ee.Reducer.variance(), rect_kernel)
		.updateMask(directions.eq(1));

	dir_mean = dir_mean.addBands(
		img
			.reduceNeighborhood(ee.Reducer.mean(), diag_kernel)
			.updateMask(directions.eq(2))
	);
	dir_var = dir_var.addBands(
		img
			.reduceNeighborhood(ee.Reducer.variance(), diag_kernel)
			.updateMask(directions.eq(2))
	);

	// and add the bands for rotated kernels
	for (var i = 1; i < 4; i++) {
		dir_mean = dir_mean.addBands(
			img
				.reduceNeighborhood(ee.Reducer.mean(), rect_kernel.rotate(i))
				.updateMask(directions.eq(2 * i + 1))
		);
		dir_var = dir_var.addBands(
			img
				.reduceNeighborhood(ee.Reducer.variance(), rect_kernel.rotate(i))
				.updateMask(directions.eq(2 * i + 1))
		);
		dir_mean = dir_mean.addBands(
			img
				.reduceNeighborhood(ee.Reducer.mean(), diag_kernel.rotate(i))
				.updateMask(directions.eq(2 * i + 2))
		);
		dir_var = dir_var.addBands(
			img
				.reduceNeighborhood(ee.Reducer.variance(), diag_kernel.rotate(i))
				.updateMask(directions.eq(2 * i + 2))
		);
	}

	// "collapse" the stack into a single band image (due to masking, each pixel has just one value in it's directional band, and is otherwise masked)
	dir_mean = dir_mean.reduce(ee.Reducer.sum());
	dir_var = dir_var.reduce(ee.Reducer.sum());

	// A finally generate the filtered value
	var varX = dir_var
		.subtract(dir_mean.multiply(dir_mean).multiply(sigmaV))
		.divide(sigmaV.add(1.0));

	var b = varX.divide(dir_var);

	var result = dir_mean.add(b.multiply(img.subtract(dir_mean)));
	return result.arrayFlatten([["sum"]]);
}
