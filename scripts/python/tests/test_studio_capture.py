"""Offline MCP crop import checks; no UI interactions or network access."""
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import studio_vision as sv


class CaptureTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.manifest = {'templates': {'create_button': {'role': 'click'}}}
        self.image = np.zeros((400, 600, 3), dtype=np.uint8)
        self.image[100:140, 200:300] = np.random.default_rng(12).integers(20, 250, (40,100,3), dtype=np.uint8)

    def capture(self, **kwargs):
        return sv.capture_from_image(self.directory.name, self.manifest, 'create_button', self.image,
                                     kwargs.get('box', (200,100,100,40)), (300,200), kwargs.get('click'))

    def test_retina_crop_and_click_offset_survive_import(self):
        self.capture(click=(260,130))
        matcher = sv.TemplateMatcher(self.directory.name, sv.load_calibration(self.directory.name))
        found = matcher.find('create_button', sv.to_gray(self.image), 2)
        self.assertEqual((found.click_x, found.click_y), (130,65))
        self.assertEqual((found.width,found.height), (100,40))

    def test_bad_crop_preserves_existing_reference(self):
        self.capture()
        path = Path(self.directory.name)/'create_button.png'
        before = path.read_bytes()
        for box in [(-1,10,100,40),(1,1,10,10),(1,1,30,30),(590,390,100,40)]:
            with self.assertRaises(ValueError): self.capture(box=box)
            self.assertEqual(path.read_bytes(),before)

    def test_duplicate_control_is_rejected(self):
        self.image[200:240,400:500] = self.image[100:140,200:300]
        with self.assertRaisesRegex(ValueError,'Ambiguous'): self.capture()
        self.assertFalse((Path(self.directory.name)/'calibration.json').exists())

    def test_unknown_control_and_scale_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unknown'):
            sv.capture_from_image(self.directory.name,self.manifest,'wrong',self.image,(200,100,100,40),(300,200))
        with self.assertRaisesRegex(ValueError,'aspect'):
            sv.capture_from_image(self.directory.name,self.manifest,'create_button',self.image,(200,100,100,40),(300,400))


if __name__ == '__main__': unittest.main()
