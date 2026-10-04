"""Build three distinct human bases from CC0 anatomy and authored garments.

  blender -b --factory-startup --python scripts/build_human_bases.py

Flight: female anatomy, short-sleeve tee and jeans. Utility: broad male anatomy,
tee and overalls. Tailored: fuller female anatomy, blouse and skirt. Each uses
its own authored CC0 garment topology and textures, distinct from the existing
citizen jacket. The shared 49-bone rig and native 16-clip retargeting are retained.
"""
import ast
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_BASES = ROOT / 'public' / 'models' / 'humans'
AUTHORING = ROOT / 'assets' / 'characters' / 'human-bases'
OUTPUT_BASES.mkdir(parents=True, exist_ok=True)
AUTHORING.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'scripts'))
from retarget_animations import authored_motion, CLIPS
from visitor_surfaces import image

LEGACY = (ROOT / 'scripts' / 'build_characters.py').read_text()
FOUNDATION = LEGACY[:LEGACY.index("skin = material(")]
# These pure geometry/weight helpers are shared with the existing body authoring
# pipeline. Execute their definitions only, never its imported suit construction.
FUNCTIONS = '\n\n'.join(ast.get_source_segment(LEGACY, node) for node in ast.parse(LEGACY).body
                        if isinstance(node, ast.FunctionDef) and node.name in
                        {'bind','surface','ellipsoid','bevel_box','loft'})


def material_maps(mat, base, normal, rough):
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    for label, bitmap, socket in [('Albedo',base,'Base Color'),('Roughness',rough,'Roughness')]:
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.label=label;tex.image=bitmap
        mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs[socket])
    tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=normal
    bump=mat.node_tree.nodes.new('ShaderNodeNormalMap');bump.inputs['Strength'].default_value=.55
    mat.node_tree.links.new(tex.outputs['Color'],bump.inputs['Color'])
    mat.node_tree.links.new(bump.outputs['Normal'],bsdf.inputs['Normal'])


def finish_images(slug):
    size=512; yy,xx=np.mgrid[:size,:size].astype(np.float32)/size
    weave=np.sin(xx*math.tau*88)*np.sin(yy*math.tau*88)
    twill=np.sin((xx+yy)*math.tau*42)
    noise=np.sin(xx*173+np.sin(yy*43))*np.sin(yy*163+xx*23)
    base=np.ones((size,size,4),np.float32);base[:,:,:3]=(.89+.025*weave+.012*twill)[:,:,None]
    color=image(f'{slug}_woven_cloth',base,size)
    rough=np.ones((size,size,4),np.float32);rough[:,:,:3]=(.76+.04*weave)[:,:,None]
    roughness=image(f'{slug}_cloth_roughness',rough,size,True)
    n=np.ones((size,size,4),np.float32);n[:,:,0]=.5+.09*np.cos(xx*math.tau*88)*np.sin(yy*math.tau*88);n[:,:,1]=.5+.09*np.sin(xx*math.tau*88)*np.cos(yy*math.tau*88);n[:,:,2]=np.sqrt(1-(n[:,:,0]*2-1)**2-(n[:,:,1]*2-1)**2)*.5+.5
    normal=image(f'{slug}_cloth_normal',n,size,True)
    pore=n.copy();pore[:,:,0]=.5+.022*noise;pore[:,:,1]=.5+.022*np.roll(noise,1,axis=0);pore[:,:,2]=.999
    pores=image(f'{slug}_skin_normal',pore,size,True)
    skin_rough=rough.copy();skin_rough[:,:,:3]=(.64+.025*noise)[:,:,None]
    skin_roughness=image(f'{slug}_skin_roughness',skin_rough,size,True)
    return color,normal,roughness,pores,skin_roughness


def authored_garment(slug, jacket, pants, pores, roughness):
    """Fit a different CC0 garment topology through its authored attachments."""
    asset_name={'flight':'female_casualsuit01','utility':'male_worksuit01','tailored':'female_elegantsuit01'}[slug]
    directory=SOURCE/'clothes'/asset_name
    source=(directory/f'{asset_name}.mhclo').read_text()
    axis_scales={};attachments=[];reading=False;delete=False;hidden=set()
    for line in source.splitlines():
        a=line.split()
        if not a or a[0].startswith('#'):continue
        if a[0] in ['x_scale','y_scale','z_scale']:
            axis={'x_scale':0,'y_scale':2,'z_scale':1}[a[0]]
            axis_scales[a[0]]=abs(vertices[int(a[1])][axis]-vertices[int(a[2])][axis])/float(a[3])
        elif a[0]=='verts':reading=True
        elif a[0]=='delete_verts':reading=False;delete=True
        elif reading:
            if len(a)==1:attachments.append(([int(a[0])]*3,[1,0,0],[0,0,0]))
            elif len(a)>=9:attachments.append((list(map(int,a[:3])),list(map(float,a[3:6])),list(map(float,a[6:9]))))
        elif delete:
            for match in re.finditer(r'\d+(?:\s*-\s*\d+)?',line):
                pair=match.group().split('-');first=int(pair[0]);last=int(pair[-1]);hidden.update(range(first,last+1))
    start=len(vertices)
    for ids,factors,offset in attachments:
        pos=sum((vertices[i]*factor for i,factor in zip(ids,factors)),Vector())
        pos+=Vector((-offset[0]*axis_scales['x_scale'],offset[2]*axis_scales['z_scale'],offset[1]*axis_scales['y_scale']))
        influences=defaultdict(float)
        for i,factor in zip(ids,factors):
            for name,value in weights[i].items():influences[name]+=max(0,factor)*value
        strongest=sorted(influences.items(),key=lambda item:-item[1])[:4];total=sum(value for _,value in strongest)
        weights[len(vertices)]={name:value/total for name,value in strongest if value>0}
        vertices.append(pos)
    uv_start=len(uvs);upper=[];lower=[]
    for line in (directory/f'{asset_name}.obj').read_text().splitlines():
        a=line.split()
        if not a:continue
        if a[0]=='vt':uvs.append(tuple(map(float,a[1:3])))
        elif a[0]=='f':
            face=[(start+int(v.split('/')[0])-1,uv_start+int(v.split('/')[1])-1) for v in a[1:]]
            z=sum(vertices[i].z for i,_ in face)/len(face)
            (lower if z < 1.05 else upper).append(face)
    diffuse=bpy.data.images.load(str(directory/f'{asset_name}_diffuse.png'));diffuse.scale(1024,1024);diffuse.pack()
    normal_path=directory/f'{asset_name}_normal.png'
    normal=bpy.data.images.load(str(normal_path)) if normal_path.exists() else pores
    if normal_path.exists():normal.colorspace_settings.name='Non-Color';normal.scale(1024,1024);normal.pack()
    for mat in [jacket,pants]:
        # Preserve authored fold/stitch textures and their exact UV placement.
        for node in list(mat.node_tree.nodes):
            if node.type not in {'BSDF_PRINCIPLED','OUTPUT_MATERIAL'}:mat.node_tree.nodes.remove(node)
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(1,1,1,1)
        material_maps(mat,diffuse,normal,roughness)
    for name,faces,mat in [('AuthoredUpperGarment',upper,jacket),('AuthoredLowerGarment',lower,pants)]:
        if not faces:continue
        obj=surface(name,faces,mat);obj['authoredUV']=True
    skin_faces=[face for face in groups['body'] if not any(index in hidden for index,_ in face)
                and sum(vertices[index].z for index,_ in face)/len(face)>.18]
    return asset_name,skin_faces



def make_boots(slug, rubber, hardware):
    for side in ['L','R']:
        ankle=bones['Foot'+side][0];x,y=ankle.x,ankle.y;z0=max(.008,ankle.z-.091)
        if slug in {'flight','tailored'}:
            rings=[(x,y+.044,z0,.052,.119),(x,y+.044,z0+.055,.055,.12),(x,y+.012,z0+.105,.049,.068),(x,y,z0+.175,.05,.048)]
            sole=[(x,y+.044,z0-.01,.057,.124),(x,y+.044,z0+.016,.057,.124)]
        else:
            rings=[(x,y+.049,z0,.074,.141),(x,y+.054,z0+.07,.073,.14),(x,y+.021,z0+.105,.065,.077),(x,y,z0+.13,.062,.06)]
            sole=[(x,y+.049,z0-.01,.078,.146),(x,y+.049,z0+.03,.078,.146)]
        loft(('UtilitySafetyBoot' if slug=='utility' else 'AnkleBoot')+side,rings,rubber,'Foot'+side)
        loft('BootSole'+side,sole,rubber,'Foot'+side)
        if slug=='utility':
            bevel_box('ProtectiveToe'+side,(x,y+.123,z0+.061),(.129,.065,.053),hardware,'Foot'+side,.014)
        else:
            bevel_box('AnkleClasp'+side,(x+.053*(1 if x>0 else -1),y,z0+.13),(.012,.04,.035),hardware,'Foot'+side,.004)


def fit_hair(hair):
    # Retain authored scalp fitting and alpha UVs. The game swaps this material
    # for profile hairstyles; the standalone base remains a complete character.
    section=LEGACY[LEGACY.index('hair_start = len(vertices)'):LEGACY.index("neck = bones['Neck'][0]")]
    exec(section,globals() | {'hair':hair})


def uv_and_maps(objects, skin, hair):
    for obj in objects:
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        if obj.data.materials[0] not in {skin,hair} and not obj.get('authoredUV'):
            for layer in list(obj.data.uv_layers):obj.data.uv_layers.remove(layer)
            obj.data.uv_layers.new(name='UVMap')
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=math.radians(65),island_margin=.025)
            bpy.ops.object.mode_set(mode='OBJECT')
        elif obj.data.uv_layers:
            obj.data.uv_layers.active.name='UVMap'
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(65))


def select_only(items):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in items: obj.hide_set(False);obj.select_set(True)
    bpy.context.view_layer.objects.active=items[0]


def build(slug):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup=FOUNDATION
    if slug in {'flight','tailored'}:setup=setup.replace("['male.target', 'male-face.target']","['female.target', 'female-face.target']")
    if slug in {'utility','tailored'}:
        marker="rig_data = json.loads"
        shaping="""\nfor v in vertices:
    if v.z < 1.64:
        v.x *= 1 + .13 * math.exp(-((v.z - 1.40) / .40) ** 2)
        v.y *= 1 + .13 * math.exp(-((v.z - 1.24) / .35) ** 2)
"""
        if slug=='tailored':shaping=shaping.replace('.13 * math.exp(-((v.z - 1.40) / .40) ** 2)', '.16 * math.exp(-((v.z - 1.13) / .28) ** 2)').replace('.13 * math.exp(-((v.z - 1.24) / .35) ** 2)', '.15 * math.exp(-((v.z - 1.25) / .30) ** 2)')
        setup=setup.replace(marker,shaping+'\n'+marker)
    exec(setup,globals())
    exec(FUNCTIONS,globals())
    global objects
    objects=[]
    cloth,normal,rough,pores,skinrough=finish_images(slug)
    skin=material('Skin',(1,1,1),.67);skinbitmap=bpy.data.images.load(str(SOURCE/'skin.png'));skinbitmap.scale(1024,1024);skinbitmap.pack()
    material_maps(skin,skinbitmap,pores,skinrough)
    jacket=material('Jacket',(.2,.30,.38) if slug=='flight' else (.26,.30,.22),.78)
    pants=material('Trousers',(.06,.10,.13) if slug=='flight' else (.12,.14,.14),.8)
    rubber=material('BootsAndGloves',(.025,.032,.04),.7)
    hardware=material('Hardware',(.22,.27,.3),.38,.55)
    iris=material('Iris',(.09,.20,.18),.25);eye_white=material('EyeWhite',(.72,.73,.70),.2)
    hair=material('Hair',(.025,.018,.012),.78)
    for mat in [jacket,pants,rubber,hardware,iris,eye_white]:material_maps(mat,cloth,normal,rough)
    hairbitmap=bpy.data.images.load(str(SOURCE/'short04_diffuse.png'));hairbitmap.scale(512,512);hairbitmap.pack();material_maps(hair,hairbitmap,normal,rough)
    hairtex=next(n for n in hair.node_tree.nodes if n.type=='TEX_IMAGE' and n.image==hairbitmap)
    hair.node_tree.links.new(hairtex.outputs['Alpha'],hair.node_tree.nodes['Principled BSDF'].inputs['Alpha']);hair.surface_render_method='DITHERED'
    garment_source,skin_faces=authored_garment(slug,jacket,pants,normal,rough)
    surface(slug.title()+'VisibleAnatomy',skin_faces,skin)
    for side in ['L','R']:
        center=joint('eye.'+side,'head')
        ellipsoid('Eye'+side,center,(.012,.012,.012),eye_white,'Head')
        ellipsoid('Iris'+side,center+Vector((0,.0114,0)),(.0057,.0015,.0057),iris,'Head',14,8)
        ellipsoid('Pupil'+side,center+Vector((0,.0128,0)),(.0026,.0007,.0026),rubber,'Head',12,6)
    fit_hair(hair);make_boots(slug,rubber,hardware)
    uv_and_maps(objects,skin,hair)
    print('NEW_HUMAN_GEOMETRY',slug,len(objects),sum(len(o.data.vertices) for o in objects),flush=True)
    clips,motion_scale=authored_motion(ROOT,rig,objects)
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    rig.animation_data.action=None;bpy.context.view_layer.update()
    select_only(objects);bpy.ops.object.join();hero=bpy.context.object;hero.name=slug.title()+'HumanBase'
    select_only([rig,hero])
    destination=OUTPUT_BASES/f'{slug}.glb'
    bpy.ops.export_scene.gltf(filepath=str(destination),export_format='GLB',use_selection=True,
        export_apply=False,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,
        export_texcoords=True,export_normals=True,export_animations=True,export_animation_mode='ACTIONS',
        export_frame_range=False,export_skins=True,export_def_bones=True)
    data=destination.read_bytes();length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length])
    height=max(v.co.z for v in hero.data.vertices)-min(v.co.z for v in hero.data.vertices)
    doc['extras']={'baseModel':slug,'height':round(height,6),'motionSpeeds':{'Walk':.975*motion_scale,'WalkFormal':.975*motion_scale,'Jog':(5/.9333333333333333)*motion_scale,'Run':8.25*motion_scale}}
    for mat in doc['materials']:
        source=bpy.data.materials.get(mat['name'])
        if source:mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=list(source.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)
        if mat['name']=='Hair':mat['alphaMode']='MASK';mat['alphaCutoff']=.38
    encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4);remainder=data[20+length:]
    destination.write_bytes(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(remainder))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+remainder)
    height=max(v.co.z for v in hero.data.vertices)-min(v.co.z for v in hero.data.vertices)
    metadata={'id':slug,'height':round(height,6),'referenceHeight':1.9331,'bones':len(rig.data.bones),'clips':list(CLIPS),
        'triangles':sum(len(p.vertices)-2 for p in hero.data.polygons),'vertices':len(hero.data.vertices),
        'geometry':{'flight':'Female anatomy with authored short-sleeve tee and jeans','utility':'Broad male anatomy with authored workwear and safety boots','tailored':'Fuller female anatomy with authored elegant blouse and skirt'}[slug],
        'bodySource':'MakeHuman CC0 base.obj + female-face.target' if slug in {'flight','tailored'} else 'MakeHuman CC0 base.obj + male.target + male-face.target',
        'garmentSource':garment_source+' (MakeHuman CC0 authored garment, original UV and texture maps)',
        'animation_source':'Quaternius Universal Animation Library Standard v3','motion_scale':motion_scale,
        'motion_speeds':{'Walk':.975*motion_scale,'WalkFormal':.975*motion_scale,'Jog':(5/.9333333333333333)*motion_scale,'Run':8.25*motion_scale},
        'images':len(doc.get('images',[])),'bytes':destination.stat().st_size}
    (OUTPUT_BASES/f'{slug}.json').write_text(json.dumps(metadata,indent=2)+'\n')
    # Match the GLB's color factors in the editable Blender material previews.
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        if not bsdf or not bsdf.inputs['Base Color'].is_linked:continue
        factor=tuple(bsdf.inputs['Base Color'].default_value)
        source_link=bsdf.inputs['Base Color'].links[0].from_socket
        mix=mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=factor
        mat.node_tree.links.new(source_link,mix.inputs[1]);mat.node_tree.links.new(mix.outputs[0],bsdf.inputs['Base Color'])
    rig.animation_data.action=clips[0];bpy.context.scene.frame_set(1);bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORING/f'{slug}.blend'))
    assert len(rig.data.bones)==49
    assert {a['name'] for a in doc['animations']}==set(CLIPS)
    assert all('uri' not in image for image in doc['images'])
    assert all('uri' not in buffer for buffer in doc['buffers'])
    assert len(doc['skins'][0]['joints']) == 49
    assert all('TEXCOORD_0' in primitive['attributes'] for mesh in doc['meshes'] for primitive in mesh['primitives'])
    assert all('baseColorTexture' in mat.get('pbrMetallicRoughness',{}) and 'normalTexture' in mat for mat in doc['materials'])
    print('HUMAN_BASE_EXPORTED',slug,json.dumps(metadata),flush=True)


requested=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
for slug in ['flight','utility','tailored']:
    if not requested or slug in requested:build(slug)
