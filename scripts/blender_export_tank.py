"""Headless Blender helper: import an FBX tank rig and export it straight to
GLB with its skin and animation clips intact. No rig changes are made here —
the static (unskinned) gun/turret meshes are baked into the skinned vertex
buffer by build-tank-model.mjs's runtime loader instead, so this step stays a
plain, lossless format conversion.

Usage: blender --background --python blender_export_tank.py -- <in.fbx> <out.glb>
"""
import sys
import bpy

fbx_path = sys.argv[-2]
out_path = sys.argv[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx_path)
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
)
print(f'BUILD_TANK_MODEL_OK {out_path}')
