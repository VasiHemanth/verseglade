use serde::Serialize;

#[derive(Serialize)]
pub struct Region {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    weight: f64,
}

#[derive(Serialize)]
pub struct Analysis {
    regions: Vec<Region>,
    engine: &'static str,
}

#[cfg(target_os = "macos")]
pub fn analyze(bytes: &[u8]) -> Result<Analysis, String> {
    use objc2::{runtime::AnyObject, AnyThread};
    use objc2_foundation::{NSArray, NSData, NSDictionary};
    use objc2_vision::{
        VNDetectFaceRectanglesRequest, VNGenerateAttentionBasedSaliencyImageRequest, VNImageOption,
        VNImageRequestHandler, VNRequest,
    };
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(bytes);
        let options = NSDictionary::<VNImageOption, AnyObject>::dictionary();
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &data,
            &options,
        );
        // Requests are created, performed, and consumed on the same background thread.
        // Input is a JPEG/PNG thumbnail with its orientation already rasterized.
        unsafe {
            let saliency = VNGenerateAttentionBasedSaliencyImageRequest::new();
            let faces = VNDetectFaceRectanglesRequest::new();
            let requests = NSArray::<VNRequest>::from_slice(&[&saliency, &faces]);
            handler
                .performRequests_error(&requests)
                .map_err(|e| e.to_string())?;
            let mut regions = Vec::new();
            if let Some(results) = saliency.results() {
                for observation in results.iter() {
                    if let Some(objects) = observation.salientObjects() {
                        for object in objects.iter() {
                            let r = object.boundingBox();
                            regions.push(Region {
                                x: r.origin.x,
                                y: 1.0 - r.origin.y - r.size.height,
                                width: r.size.width,
                                height: r.size.height,
                                weight: 3.0,
                            });
                        }
                    }
                }
            }
            if let Some(results) = faces.results() {
                for face in results.iter() {
                    let r = face.boundingBox();
                    regions.push(Region {
                        x: r.origin.x,
                        y: 1.0 - r.origin.y - r.size.height,
                        width: r.size.width,
                        height: r.size.height,
                        weight: 10.0,
                    });
                }
            }
            Ok(Analysis {
                regions,
                engine: "Apple Vision + local contrast",
            })
        }
    })
}

#[cfg(not(target_os = "macos"))]
pub fn analyze(_bytes: &[u8]) -> Result<Analysis, String> {
    Ok(Analysis {
        regions: Vec::new(),
        engine: "Local texture & contrast",
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn vision_analyzes_a_real_image_offline() {
        let result = super::analyze(include_bytes!("../icons/icon.png")).unwrap();
        assert_eq!(result.engine, "Apple Vision + local contrast");
        for r in result.regions {
            assert!(r.x >= 0.0 && r.y >= -0.0001);
            assert!(r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001);
        }
    }
}
