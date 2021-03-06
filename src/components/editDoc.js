import React, {Component, PropTypes} from 'react';
import createAlignmentPlugin from 'draft-js-alignment-plugin';
import { Header, Form, Button, Icon } from 'semantic-ui-react';
import { OrderedSet, OrderedMap } from 'immutable';
import { Editor, EditorState, RichUtils, CharacterMetadata, convertToRaw, convertFromRaw, SelectionState, genKey, ContentBlock, ContentState, Modifier, Entity } from 'draft-js';
import RichTextEditor from 'react-rte';
import { Link } from 'react-router-dom'
import createStyles from 'draft-js-custom-styles';
import ColorPicker, {colorPickerPlugin} from 'draft-js-color-picker'
const path = 'http://127.0.0.1:2000';
import socket from './../socket';
import RevisionHistory from './revisionhistory'

const numbers = ['8px', '12px', '16px', '24px', '48px', '72px'];
const fonts = ['Times New Roman', 'Arial', 'Helvetica', 'Courier', 'Verdana', 'Tahoma'];
let lineColor = 'black';

const customStyleMap = {
 MARK: {
   backgroundColor: 'Yellow',
   fontStyle: 'italic',
 },
};

const { styles, customStyleFn, exporter } = createStyles(['font-size', 'color', 'text-transform'], 'CUSTOM_', customStyleMap);

export default class EditDoc extends React.Component {
  constructor(props) {
    super(props);
    const editor = this.props.location.state.doc.content
               ? EditorState.createWithContent(convertFromRaw(JSON.parse(this.props.location.state.doc.content)))
               : EditorState.createEmpty();
    this.state = {
      editorState: editor,
      selection: editor.getSelection(),
      styled: editor,
      collaborators: this.props.location.state.doc.collaborators,
      id: this.props.location.state.doc._id,
      title: this.props.location.state.doc.title,
      author: this.props.location.state.doc.author,
      user: this.props.location.state.user,
      history: this.props.location.state.doc.history,
      log: [],
      editColor: '',
      prevEdits: {},
      intervalId: null,
      clients: [],
    };
    this.onChange = async (editorState) => {
      await this.setState({ editorState, selection: editorState.getSelection()});
      // var blocks = this.state.editorState.getCurrentContent().getBlocksAsArray();
      // console.log('own state', blocks[blocks.length-1].getCharacterList())
      socket.emit('content',
                  convertToRaw(this.state.editorState.getCurrentContent()),
                  this.state.editorState.getSelection(),
                  this.state.editColor
                );
    };
    this.getEditorState = () => this.state.editorState;
    this.picker = colorPickerPlugin(this.onChange, this.getEditorState);
    this.autoSave = this.autoSave.bind(this);
    this.save = this.save.bind(this);
    this.clearStyling = this.clearStyling.bind(this);
  }

  componentDidMount(){
    socket.emit('join', this.state.id, this.state.user);
    socket.on('joined', (color) => {
      this.setState({ editColor: color, clients: [color] });
    })
    socket.on('joinmsg', (msg, color) => {
      let tempArr = this.state.log.slice();
      tempArr.push(msg)
      let tempClients = this.state.clients.slice();
      tempClients.push(color);
      this.setState({
        log: tempArr,
        clients: tempClients,
      })
    })

    socket.on('content', (msg, currentLoc, color) => {
      console.log('should be seeing', color);
      console.log('i am ', this.state.editColor);

      //plain content updating
      let content = convertFromRaw(msg);
      const selectionState = new SelectionState(currentLoc);

      let blockMap = content.getBlockMap();
      blockMap.entrySeq().forEach((e)=> {
        const key = e[0];
        const block = e[1];
        var charList = block.getCharacterList();
        for (var c = 0; c<charList.size; c++){
          var style = charList.get(c);
          for (var i in this.state.clients){
            var co = this.state.clients[i];
            if (style.getStyle().equals(OrderedSet.of(`${co}LINE`))){
              var newStyle = CharacterMetadata.removeStyle(style, `${co}LINE`);
              charList = charList.set(c, newStyle);
            }
          }
        }
        const tempBlock = block.set('characterList', charList);
        blockMap = blockMap.set(key, tempBlock);
      })
      content = content.set('blockMap', blockMap);

      // cursor styling
      let anchor;
      if (selectionState.getEndOffset() === 0) { anchor = 0; }
      else { anchor = selectionState.getEndOffset() - 1; };
      const updated = selectionState.merge({ anchorOffset: anchor })
      let contentWithCursor = content;
      if (updated.getStartOffset() !== updated.getEndOffset()){
        contentWithCursor = Modifier.applyInlineStyle(content, updated, `${color}LINE`);
      }
      const editorWithCursor = EditorState.createWithContent(contentWithCursor);

      const next = EditorState.forceSelection(editorWithCursor, selectionState);
      const editorHighlightCursor = RichUtils.toggleInlineStyle(next, color);
      const final = EditorState.forceSelection(editorHighlightCursor, selectionState);

      this.setState({ editorState: final });
    })

    let intervalId = this.autoSave();
    this.setState({ intervalId: intervalId })
  }

  toggleInlineStyle(e, inlineStyle) {
    e.preventDefault();
    this.onChange(RichUtils.toggleInlineStyle(this.state.editorState, inlineStyle))
  }

  toggleBlockType(e, blockType) {
    e.preventDefault();
    this.onChange(RichUtils.toggleBlockType(this.state.editorState, blockType))
  }

  toggleFontSize(e) {
    // e.preventDefault();
    e.target.blur();
    const fontSize = e.target.value;
    const newEditorState = styles.fontSize.toggle(this.state.editorState, fontSize);

    return this.onChange(newEditorState);
  };

  applyColor() {
    let hex = rgbaToHex(String(this.state.color)).slice(1)
    if(!styleMap[hex]){
      styleMap[hex] = {'color': this.state.color}
    }
    console.log(styleMap);
    this.onChange(RichUtils.toggleInlineStyle(this.state.editorState, hex))
  }

  onUndo() {
    this.onChange(EditorState.undo(this.state.editorState));
  }

  onRedo() {
    this.onChange(EditorState.redo(this.state.editorState));
  }

  isSelection(editorState) {
    const selection = editorState.getSelection();
    const start = selection.getStartOffset();
    const end = selection.getEndOffset();
    return start !== end;
  };

  clearStyling(){
    const content = this.state.editorState.getCurrentContent();
    let blockMap = content.getBlockMap();
    blockMap.entrySeq().forEach((e)=> {
      const key = e[0];
      const block = e[1];
      var charList = block.getCharacterList();
      for (var c = 0; c<charList.size; c++){
        const allColors = ['red','blue','green','purple','brown','yellow'];
        var style = charList.get(c);
        for (var i in allColors){
          var color = allColors[i];
          if (style.getStyle().equals(OrderedSet.of(`${color}LINE`))){
            var newStyle = CharacterMetadata.removeStyle(style, `${color}LINE`);
            charList = charList.set(c, newStyle);
          }
        }
      }
      const tempBlock = block.set('characterList', charList);
      blockMap = blockMap.set(key, tempBlock);
    })
    return content.set('blockMap', blockMap);
  }

  save() {
    const content = this.clearStyling();
    socket.emit('save', this.state.id, convertToRaw(content));
    console.log('saved');
  }

  history(){
    this.save();
    const content = this.clearStyling();
    socket.emit('historySave', this.state.id, convertToRaw(content), content, this.state.user);

    socket.on('newHistory', saved => {
      var hist = JSON.parse(saved);
      console.log("new history!");
      const tempHist = this.state.history.slice();
      tempHist.push(hist);
      this.setState({ history: tempHist })
      console.log(tempHist);
    })
  }

  autoSave(){
    return setInterval(this.save, 30000);
  }

  restore(content){
    const editorState = EditorState.createWithContent(convertFromRaw(JSON.parse(content)));
    this.setState({ editorState })
  }

  render() {
    // console.log(this.state.history);
    var portalPath = `/portal/${this.state.user._id}`;

    const options = x => x.map(fontSize => {
      return <option key={fontSize} value={fontSize}>{fontSize}</option>;
    });

    const styleMap = {
      UPPERCASE: {
        textTransform: 'uppercase',
      },
      LOWERCASE: {
        textTransform: 'lowercase',
      },
      '8px': {
        fontSize: '8px',
      },
      '12px': {
        fontSize: '12px',
      },
      '16px': {
        fontSize: '16px',
      },
      '24px': {
        fontSize: '24px',
      },
      '48px': {
        fontSize: '48px',
      },
      '72px': {
        fontSize: '72px',
      },
      'Times New Roman': {
        fontFamily: 'Times New Roman',
      },
      Arial: {
        fontFamily: 'Arial',
      },
      Helvetica: {
        fontFamily: 'Helvetica',
      },
      Courier: {
        fontFamily: 'Courier',
      },
      Verdana: {
        fontFamily: 'Verdana',
      },
      Tahoma: {
        fontFamily: 'Tahoma',
      },
      HIGHLIGHT: {
        backgroundColor: 'yellow',
      },
      red:{
        backgroundColor: 'red',
      },
      blue:{
        backgroundColor:'blue',
      },
      green:{
        backgroundColor:'green',
      },
      purple:{
        backgroundColor:'purple',
      },
      yellow:{
        backgroundColor: 'yellow',
      },
      brown:{
        backgroundColor:'brown',
      },
      redLINE:{
        borderRight: `1px solid red`,
      },
      blueLINE:{
        borderRight: `1px solid blue`,
      },
      greenLINE:{
        borderRight: `1px solid green`,
      },
      purpleLINE:{
        borderRight: `1px solid purple`,
      },
      yellowLINE:{
        borderRight: `1px solid yellow`,
      },
      brownLINE:{
        borderRight: `1px solid red`,
      },
    };

    const presetColors = [
      '#ff00aa',
      '#F5A623',
      '#F8E71C',
      '#8B572A',
      '#7ED321',
      '#417505',
      '#BD10E0',
      '#9013FE',
      '#4A90E2',
      '#50E3C2',
      '#B8E986',
      '#000000',
      '#4A4A4A',
      '#9B9B9B',
      '#FFFFFF',
    ];

    function rgbaToHex (rgba) {
        var parts = rgba.substring(rgba.indexOf("(")).split(","),
            r = parseInt(parts[0].substring(1).trim(), 10),
            g = parseInt(parts[1].trim(), 10),
            b = parseInt(parts[2].trim(), 10),
            a = parseFloat(parts[3].substring(0, parts[3].length - 1).trim()).toFixed(2);

        return ('#' + r.toString(16) + g.toString(16) + b.toString(16) + (a * 255).toString(16).substring(0,2));
    }

    const getBlockStyle = (block) => {
        switch (block.getType()) {
            case 'left':
                return 'align-left';
            case 'center':
                return 'align-center';
            case 'right':
                return 'align-right';
            default:
                return null;
        }
    }

    return (
      <div className="masterContainer">
        <Button onClick={() => { clearInterval(this.state.intervalId); }}>
          <Link to={portalPath}>Back to Portal</Link>
        </Button>
        <h3>{this.state.title}</h3>
        <p>Author: {this.state.author.name}</p>
        <p>Collaborators:{this.state.collaborators.map(user=><li>{user.name}</li>)}</p>
        <p>Shareable Document ID: {this.state.id}</p>
        <Button onClick={this.history.bind(this)}>Save Changes</Button>
        <div className="editor">
          <div className="toolbar">
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'BOLD')} icon><Icon name="bold" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'ITALIC')} icon><Icon name="italic" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'UNDERLINE')} icon><Icon name="underline" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'STRIKETHROUGH')} icon><Icon name="strikethrough" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'HIGHLIGHT')}>Highlight</Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'UPPERCASE')}>ABC</Button>
            <Button className="Button" onMouseDown={e => this.toggleInlineStyle(e, 'LOWERCASE')}>abc</Button>
            <Button className="Button" onClick={this.onUndo.bind(this)} icon><Icon name="undo" /></Button>
            <Button className="Button" onClick={this.onRedo.bind(this)} icon><Icon name="redo" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'unordered-list-item')} icon><Icon name="unordered list" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'ordered-list-item')} icon><Icon name="ordered list" /></Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-one')}>H1</Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-two')}>H2</Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-three')}>H3</Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-four')}>H4</Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-five')}>H5</Button>
            <Button className="Button" onMouseDown={e => this.toggleBlockType(e, 'header-six')}>H6</Button>
            <Button className="colorpicker"> Font Color
              <ColorPicker
                toggleColor={color => {
                  this.setState({
                    color: color
                  })
                  this.picker.addColor(color)
                  this.applyColor()
                }}
                presetColors = {presetColors}
                color={this.state.color}
              />
            </Button>
            <br></br>
            <Button className="align-left" onMouseDown={e => this.toggleBlockType(e, 'left')} icon><Icon name="align left" /></Button>
            <Button className="align-center" onMouseDown={e => this.toggleBlockType(e, 'center')} icon><Icon name="align center" /></Button>
            <Button className="align-left" onMouseDown={e => this.toggleBlockType(e, 'right')} icon><Icon name="align right" /></Button>
            <select className="Button" onChange={e => this.toggleInlineStyle(e, e.target.value)}>
              {numbers.map(item => <option key={item}>{item}</option>)}
            </select>
            <select className="Button" onChange={e => this.toggleInlineStyle(e, e.target.value)}>
              {fonts.map(item => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="textbox">
            <Editor
              editorState={this.state.selection? EditorState.forceSelection(this.state.editorState, this.state.selection) : this.state.editorState}
              customStyleMap={styleMap}
              onChange={this.onChange}
              placeholder="Click here to begin writing..."
              customStyleFn={customStyleFn}
              blockStyleFn={getBlockStyle}
              onChange={this.onChange}
              onTab={this.onTab}
              readOnly={this.state.readOnly}
              onFocus={this.onFocus}
            />
          </div>
        </div>
        <RevisionHistory title={this.state.title}
                         history = {this.state.history}
                         restore = {this.restore.bind(this)}
                       />
        <div style={{border:"1px solid black", marginTop: "2em"}}>
          <p><u>Edit Log</u></p>
          {this.state.log.map(msg => <li>{msg}</li>)}
        </div>
      </div>
    );
  }
}
